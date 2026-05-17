"use strict";

const USE_REAL_SERVER = process.env.SLA_AI_ENABLED === "true";

const path = require("path");
const fetch = require("node-fetch");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const BMC_INTEGRATION_PATH = process.env.BMC_INTEGRATION_PATH;
const BMC_INTEGRATION_ID = process.env.BMC_INTEGRATION_ID;
const BMC_INTEGRATION_KEY = process.env.BMC_INTEGRATION_KEY;
const MAX_RISKY_LINES = 10;

function validateConfig() {
  const missing = [];
  if (!BMC_INTEGRATION_PATH) missing.push("BMC_INTEGRATION_PATH");
  if (!BMC_INTEGRATION_ID) missing.push("BMC_INTEGRATION_ID");
  if (!BMC_INTEGRATION_KEY) missing.push("BMC_INTEGRATION_KEY");
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

function dedupeRiskyStatements(riskyStatements) {
  const unique = [];
  const seen = new Set();

  for (const stmt of riskyStatements || []) {
    const key = `${stmt.line}-${(stmt.code || "").trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(stmt);
    }
  }

  return unique.slice(0, MAX_RISKY_LINES);
}

function buildContextWindow(sourceCode, lineNumber, radius = 3) {
  const lines = sourceCode.split(/\r?\n/);
  const start = Math.max(1, lineNumber - radius);
  const end = Math.min(lines.length, lineNumber + radius);

  return Array.from({ length: end - start + 1 }, (_, idx) => {
    const current = start + idx;
    return `${current}: ${lines[current - 1] || ""}`;
  }).join("\n");
}

function buildPrompt(sourceCode, riskyStatements, metadata = {}) {
  const limited = dedupeRiskyStatements(riskyStatements);
  const trimmedSource = sourceCode.slice(0, 12000);

  const hotspotText = limited.map((s, idx) => {
    const context = buildContextWindow(sourceCode, s.line, 3);
    return [
      `Hotspot ${idx + 1}`,
      `Line: ${s.line}`,
      `Statement Type: ${s.type || "UNKNOWN"}`,
      `Predicted Combined CPU: ${Number(s.combined || 0).toFixed(2)}%`,
      `Predicted Attributed CPU: ${Number(s.attributed || 0).toFixed(2)}%`,
      `Predicted Executed CPU: ${Number(s.executed || 0).toFixed(2)}%`,
      `Source Line: ${s.code || ""}`,
      `Context:\n${context}`,
    ].join("\n");
  }).join("\n\n");

  return `
You are a COBOL performance optimization expert for enterprise mainframe batch systems.

Your task is to suggest safe CPU optimizations for only the listed high-risk COBOL lines.

STRICT RULES:
1. Preserve business semantics exactly.
2. Do not change validations, conditions, business rules, record counts, or financial logic.
3. Do not suggest removing code, skipping logic, deleting statements, or bypassing checks.
4. Do not suggest dead-code removal unless the input explicitly says a line is proven dead code.
5. Give only 2 or 3 suggestions per hotspot.
6. Focus on CPU-safe improvements such as loop efficiency, invariant calculation hoisting, repeated computation reduction, file I/O efficiency, DB2 access efficiency, working-storage reuse, and reducing repeated execution.
7. Every suggestion must include: suggestion, reason, and safety level.
8. If no safe suggestion is possible, say exactly: No safe optimization recommendation.
9. Mention only the listed hotspot lines.
10. Keep suggestions concise and enterprise-appropriate.

PROGRAM METADATA:
- Program Name: ${metadata.programName || "UNKNOWN"}
- Predicted Whole Program CPU: ${metadata.programCpuTime ?? "UNKNOWN"}
- SLA Threshold: ${metadata.slaThreshold ?? "UNKNOWN"}
- SLA Status: ${metadata.slaStatus || "UNKNOWN"}

Return valid JSON only in this format:
{
  "summary": "short summary",
  "hotspots": [
    {
      "line": 123,
      "type": "COMPUTE",
      "suggestions": [
        {
          "suggestion": "text",
          "reason": "text",
          "safety": "High"
        }
      ]
    }
  ]
}

HIGH-RISK HOTSPOTS:
${hotspotText}

FULL COBOL SOURCE FOR CONTEXT:
${trimmedSource}
`.trim();
}

function fallbackSuggestions(riskyStatements) {
  return {
    summary: "LLM response unavailable. Returning safe fallback guidance.",
    hotspots: (riskyStatements || []).slice(0, 3).map((stmt) => ({
      line: stmt.line,
      type: stmt.type || "UNKNOWN",
      suggestions: [
        {
          suggestion: "Review whether invariant calculations in this execution path can be moved outside repeated loop execution.",
          reason: "Repeated arithmetic inside loops often increases CPU without changing business output.",
          safety: "High",
        },
        {
          suggestion: "Check for repeated file or DB access in the same path and evaluate whether access ordering or reuse can reduce repeated work.",
          reason: "Reducing repeated I/O or access preparation can lower CPU while preserving semantics.",
          safety: "Medium",
        },
      ],
    })),
  };
}

async function getOptimizationSuggestions(sourceCode, riskyStatements, metadata) {
  if (!USE_REAL_SERVER) {
    return {
      summary: "LLM response unavailable. Returning safe fallback guidance.",
      hotspots: [],
    };
  }

  validateConfig();
  const limited = dedupeRiskyStatements(riskyStatements);
  const userPrompt = buildPrompt(sourceCode, limited, metadata);
  const url = `${BMC_INTEGRATION_PATH.replace(/\/$/, "")}/generate`;

  const headers = {
    Authorization: `Bearer ${BMC_INTEGRATION_KEY}`,
    "integration-id": BMC_INTEGRATION_ID,
    "Content-Type": "application/json",
  };

  const payload = {
    messages: [
      {
        role: "system",
        content:
          "You are a COBOL CPU optimization expert. Return only valid JSON. Never propose logic-changing suggestions. Never remove validations, conditions, business rules, SQL intent, or file-processing intent.",
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    temperature: 0,
    max_completion_tokens: 700,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(`LLM HTTP ${response.status}: ${rawText}`);
    }

    const result = JSON.parse(rawText);
    const content = result?.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("Empty LLM response content");
    }

    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.hotspots)) {
      throw new Error("Invalid LLM JSON schema");
    }

    return parsed;
  } catch (error) {
    console.error("AI optimization request failed:", error.message);
    return fallbackSuggestions(limited);
  }
}

module.exports = { getOptimizationSuggestions };

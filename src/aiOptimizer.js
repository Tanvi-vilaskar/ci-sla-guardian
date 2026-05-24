"use strict";

const path = require("path");
const fetch = require("node-fetch");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const BMC_INTEGRATION_PATH = process.env.BMC_INTEGRATION_PATH;
const BMC_INTEGRATION_ID   = process.env.BMC_INTEGRATION_ID;
const BMC_INTEGRATION_KEY  = process.env.BMC_INTEGRATION_KEY;
const GROQ_API_KEY         = process.env.GROQ_API_KEY;
// Default model — llama-3.3-70b-versatile is free-tier on Groq and strong for JSON tasks
const GROQ_MODEL           = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_RISKY_LINES      = 10;

// ─────────────────────────────────────────────────────────────
// Config helpers
// ─────────────────────────────────────────────────────────────

function isBMCConfigured() {
  return !!(BMC_INTEGRATION_PATH && BMC_INTEGRATION_ID && BMC_INTEGRATION_KEY);
}

function isGroqConfigured() {
  return !!GROQ_API_KEY;
}

// ─────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────

function dedupeRiskyStatements(riskyStatements) {
  const unique = [];
  const seen   = new Set();

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
  const end   = Math.min(lines.length, lineNumber + radius);

  return Array.from({ length: end - start + 1 }, (_, idx) => {
    const current = start + idx;
    return `${current}: ${lines[current - 1] || ""}`;
  }).join("\n");
}

function buildPrompt(sourceCode, riskyStatements, metadata = {}) {
  const limited      = dedupeRiskyStatements(riskyStatements);
  const trimmedSource = sourceCode.slice(0, 12000);

  const hotspotText = limited
    .map((s, idx) => {
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
    })
    .join("\n\n");

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

Return valid JSON only in this format (no markdown fences, no extra text):
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
          suggestion:
            "Review whether invariant calculations in this execution path can be moved outside repeated loop execution.",
          reason:
            "Repeated arithmetic inside loops often increases CPU without changing business output.",
          safety: "High",
        },
        {
          suggestion:
            "Check for repeated file or DB access in the same path and evaluate whether access ordering or reuse can reduce repeated work.",
          reason:
            "Reducing repeated I/O or access preparation can lower CPU while preserving semantics.",
          safety: "Medium",
        },
      ],
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// BMC LLM call
// ─────────────────────────────────────────────────────────────

async function callBMCLLM(userPrompt) {
  const url = `${BMC_INTEGRATION_PATH.replace(/\/$/, "")}/generate`;

  const headers = {
    Authorization:   `Bearer ${BMC_INTEGRATION_KEY}`,
    "integration-id": BMC_INTEGRATION_ID,
    "Content-Type":  "application/json",
  };

  const payload = {
    messages: [
      {
        role: "system",
        content:
          "You are a COBOL CPU optimization expert. Return only valid JSON. Never propose logic-changing suggestions. Never remove validations, conditions, business rules, SQL intent, or file-processing intent.",
      },
      { role: "user", content: userPrompt },
    ],
    temperature:            0,
    max_completion_tokens:  700,
  };

  const response = await fetch(url, {
    method:  "POST",
    headers,
    body:    JSON.stringify(payload),
    timeout: 10000, // fail fast so we can try Groq
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`BMC LLM HTTP ${response.status}: ${rawText}`);
  }

  const result  = JSON.parse(rawText);
  const content = result?.choices?.[0]?.message?.content?.trim();

  if (!content) throw new Error("Empty BMC LLM response content");

  const parsed = JSON.parse(content);
  if (!parsed || !Array.isArray(parsed.hotspots)) {
    throw new Error("Invalid BMC LLM JSON schema");
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────
// Groq API fallback
// Groq exposes an OpenAI-compatible endpoint — ultra-fast inference,
// generous free tier (14 400 requests/day on the free plan).
// ─────────────────────────────────────────────────────────────

async function callGroqFallback(userPrompt) {
  if (!isGroqConfigured()) {
    throw new Error("GROQ_API_KEY not set — cannot use Groq fallback");
  }

  const payload = {
    model:       GROQ_MODEL,
    temperature: 0,
    max_tokens:  1024,
    // Ask Groq to return JSON directly — avoids markdown fences
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a COBOL CPU optimization expert. Return only valid JSON with no markdown fences. Never propose logic-changing suggestions. Never remove validations, conditions, business rules, SQL intent, or file-processing intent.",
      },
      { role: "user", content: userPrompt },
    ],
  };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method:  "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Groq API HTTP ${response.status}: ${rawText}`);
  }

  const result  = JSON.parse(rawText);
  // Groq uses the same OpenAI response envelope as BMC
  const content = result?.choices?.[0]?.message?.content?.trim();

  if (!content) throw new Error("Empty Groq response content");

  // Strip any accidental markdown fences just in case
  const clean  = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(clean);

  if (!parsed || !Array.isArray(parsed.hotspots)) {
    throw new Error("Invalid Groq JSON schema");
  }

  // Tag the summary so callers know which engine answered
  parsed.summary = `[Groq Fallback] ${parsed.summary || ""}`.trim();
  return parsed;
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

async function getOptimizationSuggestions(
  sourceCode,
  riskyStatements,
  metadata = {}
) {
  if (!Array.isArray(riskyStatements) || riskyStatements.length === 0) {
    return {
      summary:  "No HIGH CPU-risk statements detected.",
      hotspots: [],
    };
  }

  const limited    = dedupeRiskyStatements(riskyStatements);
  const userPrompt = buildPrompt(sourceCode, limited, metadata);

  // ── 1. Try BMC first ────────────────────────────────────────
  if (isBMCConfigured()) {
    try {
      const result = await callBMCLLM(userPrompt);
      console.log("AI optimization: BMC LLM succeeded.");
      return result;
    } catch (bmcError) {
      console.warn(
        "BMC LLM unavailable, switching to Groq fallback:",
        bmcError.message
      );
    }
  } else {
    console.warn("BMC not configured. Trying Groq fallback directly.");
  }

  // ── 2. Try Groq fallback ────────────────────────────────────
  try {
    const result = await callGroqFallback(userPrompt);
    console.log("AI optimization: Groq fallback succeeded.");
    return result;
  } catch (groqError) {
    console.error("Groq fallback also failed:", groqError.message);
  }

  // ── 3. Static fallback ──────────────────────────────────────
  return fallbackSuggestions(limited);
}

module.exports = { getOptimizationSuggestions };

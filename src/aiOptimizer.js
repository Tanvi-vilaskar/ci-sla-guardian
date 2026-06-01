"use strict";

const path = require("path");
const fetch = require("node-fetch");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const BMC_INTEGRATION_PATH = process.env.BMC_INTEGRATION_PATH;
const BMC_INTEGRATION_ID = process.env.BMC_INTEGRATION_ID;
const BMC_INTEGRATION_KEY = process.env.BMC_INTEGRATION_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_RISKY_LINES = 10;

function isBMCConfigured() {
  return !!(BMC_INTEGRATION_PATH && BMC_INTEGRATION_ID && BMC_INTEGRATION_KEY);
}

function isGroqConfigured() {
  return !!GROQ_API_KEY;
}

function buildContextWindow(sourceCode, lineNumber, radius = 5) {
  const lines = sourceCode.split(/\r?\n/);
  const start = Math.max(1, lineNumber - radius);
  const end = Math.min(lines.length, lineNumber + radius);

  return Array.from({ length: end - start + 1 }, (_, idx) => {
    const current = start + idx;
    const marker = current === lineNumber ? ">>>" : "   ";
    return `${marker} ${current}: ${lines[current - 1] || ""}`;
  }).join("\n");
}

function filterBreachingLines(lineByLineResults, lineCpuThreshold) {
  const threshold = parseFloat(lineCpuThreshold) || 15.0;

  return (lineByLineResults || [])
    .filter((stmt) => parseFloat(stmt.combined || stmt.executed || 0) > threshold)
    .sort((a, b) => (parseFloat(b.combined) || 0) - (parseFloat(a.combined) || 0))
    .slice(0, MAX_RISKY_LINES);
}

function buildPrompt(sourceCode, breachingLines, metadata = {}) {
  const lineThreshold = parseFloat(metadata.lineCpuThreshold) || 15.0;

  const hotspotText = breachingLines
    .map((stmt, idx) => {
      const loopDepth =
        metadata.lineDepthMap
          ? (metadata.lineDepthMap[String(stmt.line)] ??
            metadata.lineDepthMap[stmt.line] ??
            stmt.loopDepth ??
            "unknown")
          : (stmt.loopDepth ?? "unknown");

      const isInsideLoop =
        metadata.lineInsideLoop
          ? ((metadata.lineInsideLoop[String(stmt.line)] ??
              metadata.lineInsideLoop[stmt.line] ??
              (stmt.insideLoop ? 1 : 0)) === 1
              ? "YES"
              : "NO")
          : (stmt.insideLoop ? "YES" : "NO");

      const estimatedExecutions =
        metadata.lineEstimatedExecutions
          ? (metadata.lineEstimatedExecutions[String(stmt.line)] ??
            metadata.lineEstimatedExecutions[stmt.line] ??
            stmt.estimatedExecutions ??
            "unknown")
          : (stmt.estimatedExecutions ?? "unknown");

      const context = buildContextWindow(sourceCode, stmt.line, 5);

      return [
        `--- Breaching Line ${idx + 1} of ${breachingLines.length} ---`,
        `Line Number         : ${stmt.line}`,
        `Statement Type      : ${stmt.type || "UNKNOWN"}`,
        `Combined CPU        : ${Number(stmt.combined || 0).toFixed(4)}s  ← breaches line CPU threshold of ${lineThreshold}s`,
        `Attributed CPU      : ${Number(stmt.attributed || 0).toFixed(4)}s`,
        `Executed CPU        : ${Number(stmt.executed || 0).toFixed(4)}s`,
        `Loop Depth          : ${loopDepth}`,
        `Inside Loop         : ${isInsideLoop}`,
        `Est. Executions     : ${estimatedExecutions}`,
        ``,
        `Source context (>>> marks the breaching line):`,
        context,
      ].join("\n");
    })
    .join("\n\n");

  return `
You are a COBOL performance optimization expert for enterprise mainframe batch systems.

TASK:
Analyze only the listed lines. Each listed line exceeds the statement CPU threshold of ${lineThreshold}s.
Suggest safe, actionable optimization for EACH breaching line based on the actual statement type,
loop depth, estimated execution pressure, and source context. Do NOT suggest optimizations for lines
not listed below.

STRICT RULES:
1. Preserve business semantics exactly — never change logic, conditions, or financial rules.
2. Do not suggest removing code, skipping validations, or bypassing business checks.
3. Give exactly 1 suggestion per breaching line.
4. Base suggestion on the actual statement type and source context shown.
5. Treat "Est. Executions" as a static estimate, not an exact runtime count.
6. For lines inside loops, focus on invariant extraction, temporary caching, accumulator restructuring, or reducing repeated work.
7. For COMPUTE lines, only suggest hoisting a sub-expression when that exact sub-expression is loop-invariant for the relevant loop.
8. For ADD/SUBTRACT lines, focus on local accumulation or reduced repeated updates only when semantics remain unchanged.
9. For PERFORM lines, focus on repeated paragraph-call overhead only if the paragraph is very small and repeatedly invoked.
10. For IF lines, only suggest condition simplification or branch-cost reduction when business logic is unchanged.
11. For file I/O lines, focus on buffering, blocking, or access ordering.
12. The suggestion must have: suggestion, reason, safety.
13. If no safe optimization exists for a line, return "No safe optimization recommendation."
14. Never claim an exact iteration count unless it is explicitly shown; refer to it as estimated execution pressure.

PROGRAM METADATA:
- Program Name          : ${metadata.programName || "UNKNOWN"}
- Total Program CPU     : ${metadata.programCpuTime ?? "UNKNOWN"}s
- Program SLA Threshold : ${metadata.slaThreshold ?? "UNKNOWN"}s
- Line CPU Threshold    : ${lineThreshold}s
- SLA Status            : ${metadata.slaStatus || "UNKNOWN"}
- Cyclomatic Complexity : ${metadata.cyclomaticComplexity ?? "UNKNOWN"}
- Max Loop Depth        : ${metadata.maxLoopDepth ?? "UNKNOWN"}
- Total Nested Loops    : ${metadata.nestedLoopCount ?? "UNKNOWN"}
- Max Estimated Pressure: ${metadata.estIterations ?? "UNKNOWN"}
- Total PERFORM Loops   : ${metadata.totalPerforms ?? "UNKNOWN"}

BREACHING LINES (combined CPU > ${lineThreshold}s — suggestion required for each):
${hotspotText}

Return valid JSON only — no markdown fences, no extra text:
{
  "summary": "one sentence describing which lines are hot and the dominant repeated-work pattern",
  "hotspots": [
    {
      "line": <line_number>,
      "type": "<statement_type>",
      "suggestions": [
        {
          "suggestion": "specific actionable change referencing the actual code pattern",
          "reason": "why this reduces CPU for this specific statement and context",
          "safety": "High | Medium | Low"
        }
      ]
    }
  ]
}
`.trim();
}

function extractJsonObject(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Empty non-text LLM response");
  }

  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(clean);
  } catch (_) {}

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON object found in LLM response");
  }

  return JSON.parse(clean.slice(first, last + 1));
}

function normalizeHotspots(parsed) {
  if (!parsed || !Array.isArray(parsed.hotspots)) {
    throw new Error("Invalid JSON schema: hotspots missing");
  }

  parsed.hotspots = parsed.hotspots.map((h) => ({
    line: Number(h.line || 0),
    type: h.type || "UNKNOWN",
    suggestions: Array.isArray(h.suggestions) && h.suggestions.length > 0
      ? [
          {
            suggestion: String(h.suggestions[0]?.suggestion || "No safe optimization recommendation."),
            reason: String(h.suggestions[0]?.reason || "No reason provided."),
            safety: ["High", "Medium", "Low"].includes(h.suggestions[0]?.safety)
              ? h.suggestions[0].safety
              : "Low",
          },
        ]
      : [
          {
            suggestion: "No safe optimization recommendation.",
            reason: "LLM did not provide a valid structured suggestion list.",
            safety: "Low",
          },
        ],
  }));

  return parsed;
}

async function callBMCLLM(userPrompt) {
  if (!isBMCConfigured()) {
    throw new Error("BMC not configured");
  }

  const url = `${BMC_INTEGRATION_PATH.replace(/\/$/, "")}/generate`;

  const payload = {
    messages: [
      {
        role: "system",
        content:
          "You are a COBOL CPU optimization expert. Return only valid JSON. Never propose logic-changing suggestions. Never remove validations, conditions, business rules, SQL intent, or file-processing intent.",
      },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    max_completion_tokens: 1000,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BMC_INTEGRATION_KEY}`,
      "integration-id": BMC_INTEGRATION_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    timeout: 10000,
  });

  const rawText = await response.text();
  if (!response.ok) throw new Error(`BMC HTTP ${response.status}: ${rawText}`);

  const result = JSON.parse(rawText);
  const content = result?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty BMC response");

  const parsed = normalizeHotspots(extractJsonObject(content));
  parsed.source = "BMC AMI";
  return parsed;
}

async function callGroqLLM(userPrompt) {
  if (!isGroqConfigured()) {
    throw new Error("GROQ_API_KEY not set");
  }

  const payload = {
    model: GROQ_MODEL,
    temperature: 0,
    max_tokens: 1500,
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
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}: ${rawText}`);

  const result = JSON.parse(rawText);
  const content = result?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty Groq response");

  const parsed = normalizeHotspots(extractJsonObject(content));
  parsed.source = "Groq";
  return parsed;
}

function computeCombinedConfidence(bmcResult, groqResult) {
  const bmcLines = new Set((bmcResult.hotspots || []).map((h) => h.line));
  const groqLines = new Set((groqResult.hotspots || []).map((h) => h.line));

  const allLines = new Set([...bmcLines, ...groqLines]);
  const agreedLines = [...allLines].filter((l) => bmcLines.has(l) && groqLines.has(l));
  const agreement = allLines.size > 0 ? agreedLines.length / allLines.size : 0;

  if (agreement >= 0.8) return "High";
  if (agreement >= 0.5) return "Medium";
  return "Low";
}

function mergeHotspots(bmcHotspots = [], groqHotspots = []) {
  const byLine = new Map();

  for (const h of bmcHotspots) {
    byLine.set(h.line, {
      line: h.line,
      type: h.type,
      bmc_suggestions: h.suggestions || [],
      groq_suggestions: [],
    });
  }

  for (const h of groqHotspots) {
    if (byLine.has(h.line)) {
      byLine.get(h.line).groq_suggestions = h.suggestions || [];
    } else {
      byLine.set(h.line, {
        line: h.line,
        type: h.type,
        bmc_suggestions: [],
        groq_suggestions: h.suggestions || [],
      });
    }
  }

  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

function buildDualResult(bmcResult, groqResult) {
  const combinedConfidence = computeCombinedConfidence(bmcResult, groqResult);
  const mergedHotspots = mergeHotspots(bmcResult.hotspots, groqResult.hotspots);

  return {
    summary: `[BMC AMI] ${bmcResult.summary || ""}`,
    groq_summary: `[Groq] ${groqResult.summary || ""}`,
    combined_confidence: combinedConfidence,
    engines_used: ["BMC AMI", "Groq"],
    hotspots: mergedHotspots,
    aiSuggestions: mergedHotspots.map((h) => ({
      line: h.line,
      type: h.type,
      bmc_suggestions: h.bmc_suggestions,
      groq_suggestions: h.groq_suggestions,
    })),
  };
}

function fallbackSuggestions(breachingLines) {
  return {
    summary: "LLM response unavailable. Returning safe fallback guidance.",
    groq_summary: null,
    combined_confidence: null,
    engines_used: ["static-fallback"],
    hotspots: (breachingLines || []).slice(0, 3).map((stmt) => ({
      line: stmt.line,
      type: stmt.type || "UNKNOWN",
      bmc_suggestions: [],
      groq_suggestions: [],
      suggestions: [
        {
          suggestion:
            "Review whether loop-invariant calculations in this path can be moved outside the repeated loop region without changing semantics.",
          reason:
            "Repeated arithmetic inside frequently executed loop regions often increases CPU cost.",
          safety: "High",
        },
      ],
    })),
  };
}

async function getOptimizationSuggestions(sourceCode, lineByLineResults, metadata = {}) {
  const breachingLines = filterBreachingLines(
    lineByLineResults,
    metadata.lineCpuThreshold
  );

  if (breachingLines.length === 0) {
    return {
      summary: "No individual lines exceed the configured line CPU threshold.",
      groq_summary: null,
      combined_confidence: null,
      engines_used: [],
      hotspots: [],
    };
  }

  console.error(
    `Lines breaching line CPU threshold (${metadata.lineCpuThreshold}s): ` +
      breachingLines.map((l) => `line ${l.line} (${l.combined}s)`).join(", ")
  );

  const userPrompt = buildPrompt(sourceCode, breachingLines, metadata);

  const bmcPromise = isBMCConfigured()
    ? callBMCLLM(userPrompt).catch((err) => {
        console.warn("BMC LLM failed:", err.message);
        return null;
      })
    : Promise.resolve(null);

  const groqPromise = isGroqConfigured()
    ? callGroqLLM(userPrompt).catch((err) => {
        console.warn("Groq LLM failed:", err.message);
        return null;
      })
    : Promise.resolve(null);

  const [bmcResult, groqResult] = await Promise.all([bmcPromise, groqPromise]);

  if (bmcResult && groqResult) {
    console.error("AI optimization: Both BMC and Groq succeeded — dual analysis complete.");
    return buildDualResult(bmcResult, groqResult);
  }

  if (bmcResult) {
    console.error("AI optimization: BMC succeeded. Groq unavailable.");
    bmcResult.groq_summary = null;
    bmcResult.combined_confidence = null;
    bmcResult.engines_used = ["BMC AMI"];
    return bmcResult;
  }

  if (groqResult) {
    console.error("AI optimization: Groq succeeded. BMC unavailable.");
    groqResult.summary = `[Groq] ${groqResult.summary || ""}`;
    groqResult.groq_summary = groqResult.summary;
    groqResult.combined_confidence = null;
    groqResult.engines_used = ["Groq"];
    return groqResult;
  }

  console.error("Both BMC and Groq failed. Using static fallback.");
  return fallbackSuggestions(breachingLines);
}

module.exports = { getOptimizationSuggestions, filterBreachingLines };
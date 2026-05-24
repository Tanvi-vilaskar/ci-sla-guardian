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

function buildContextWindow(sourceCode, lineNumber, radius = 5) {
  const lines = sourceCode.split(/\r?\n/);
  const start = Math.max(1, lineNumber - radius);
  const end   = Math.min(lines.length, lineNumber + radius);

  return Array.from({ length: end - start + 1 }, (_, idx) => {
    const current = start + idx;
    const marker  = current === lineNumber ? ">>>" : "   ";
    return `${marker} ${current}: ${lines[current - 1] || ""}`;
  }).join("\n");
}

// ─────────────────────────────────────────────────────────────
// NEW: Filter statements that breach the per-line SLA threshold
// Only these lines get AI suggestions
// ─────────────────────────────────────────────────────────────

function filterBreachingLines(lineByLineResults, slaThreshold) {
  const threshold = parseFloat(slaThreshold) || 5.0;

  return (lineByLineResults || [])
    .filter(stmt => {
      const cpu = parseFloat(stmt.combined || stmt.executed || 0);
      return cpu > threshold;
    })
    .sort((a, b) => {
      // Sort by combined CPU descending — worst offender first
      return (parseFloat(b.combined) || 0) - (parseFloat(a.combined) || 0);
    })
    .slice(0, MAX_RISKY_LINES);
}

// ─────────────────────────────────────────────────────────────
// UPDATED: buildPrompt — generalized for any program,
// only for lines whose CPU breaches SLA threshold
// ─────────────────────────────────────────────────────────────

function buildPrompt(sourceCode, breachingLines, metadata = {}) {
  const threshold = parseFloat(metadata.slaThreshold) || 5.0;

  // Build per-line section with full context
  const hotspotText = breachingLines.map((stmt, idx) => {
    const loopDepth = metadata.lineDepthMap
      ? (metadata.lineDepthMap[String(stmt.line)] ?? "unknown")
      : "unknown";

    const isInsideLoop = metadata.lineInsideLoop
      ? (metadata.lineInsideLoop[String(stmt.line)] === 1 ? "YES" : "NO")
      : "unknown";

    const context = buildContextWindow(sourceCode, stmt.line, 5);

    return [
      `--- Breaching Line ${idx + 1} of ${breachingLines.length} ---`,
      `Line Number   : ${stmt.line}`,
      `Statement Type: ${stmt.type || "UNKNOWN"}`,
      `Combined CPU  : ${Number(stmt.combined || 0).toFixed(4)}s  ← breaches SLA threshold of ${threshold}s`,
      `Attributed CPU: ${Number(stmt.attributed || 0).toFixed(4)}s`,
      `Executed CPU  : ${Number(stmt.executed || 0).toFixed(4)}s`,
      `Loop Depth    : ${loopDepth}`,
      `Inside Loop   : ${isInsideLoop}`,
      ``,
      `Source context (>>> marks the breaching line):`,
      context,
    ].join("\n");
  }).join("\n\n");

  return `
You are a COBOL performance optimization expert for enterprise mainframe batch systems.

TASK:
Analyze only the listed lines. Each line's CPU time exceeds the SLA threshold of ${threshold}s.
Suggest safe, actionable optimizations for EACH breaching line based on its type, loop depth,
and source context. Do NOT suggest optimizations for lines not listed below.

STRICT RULES:
1. Preserve business semantics exactly — never change logic, conditions, or financial rules.
2. Do not suggest removing code, skipping validations, or bypassing business checks.
3. Give exactly 2 suggestions per breaching line.
4. Base suggestions on the ACTUAL statement type and loop context shown — be specific.
5. For lines inside deep loops: focus on loop hoisting, invariant extraction, loop unrolling.
6. For COMPUTE lines: focus on reducing repeated arithmetic, caching intermediate results.
7. For ADD/SUBTRACT lines: focus on accumulator patterns, batching, reducing iteration count.
8. For PERFORM lines: focus on reducing call overhead, inlining small paragraphs.
9. For IF lines: focus on condition reordering, short-circuit evaluation.
10. For file I/O lines: focus on buffering, blocking factor, access pattern.
11. Every suggestion must have: suggestion (specific), reason (why it reduces CPU), safety (High/Medium/Low).
12. If no safe optimization exists for a line, return: "No safe optimization recommendation."

PROGRAM METADATA:
- Program Name        : ${metadata.programName || "UNKNOWN"}
- Total Program CPU   : ${metadata.programCpuTime ?? "UNKNOWN"}s
- SLA Threshold       : ${threshold}s
- SLA Status          : ${metadata.slaStatus || "UNKNOWN"}
- Cyclomatic Complexity: ${metadata.cyclomaticComplexity ?? "UNKNOWN"}
- Max Loop Depth      : ${metadata.maxLoopDepth ?? "UNKNOWN"}
- Total Nested Loops  : ${metadata.nestedLoopCount ?? "UNKNOWN"}
- Estimated Iterations: ${metadata.estIterations ?? "UNKNOWN"}
- Total PERFORM Loops : ${metadata.totalPerforms ?? "UNKNOWN"}

BREACHING LINES (CPU > ${threshold}s — suggestions required for each):
${hotspotText}

Return valid JSON only — no markdown fences, no extra text:
{
  "summary": "one sentence: which lines breach SLA and the dominant pattern causing it",
  "hotspots": [
    {
      "line": <line_number>,
      "type": "<statement_type>",
      "suggestions": [
        {
          "suggestion": "specific actionable change referencing the actual code pattern",
          "reason": "why this reduces CPU for this specific statement and loop context",
          "safety": "High | Medium | Low"
        }
      ]
    }
  ]
}
`.trim();
}

// ─────────────────────────────────────────────────────────────
// Fallback suggestions (when both BMC and Groq fail)
// ─────────────────────────────────────────────────────────────

function fallbackSuggestions(breachingLines) {
  return {
    summary: "LLM response unavailable. Returning safe fallback guidance.",
    hotspots: (breachingLines || []).slice(0, 3).map((stmt) => ({
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
    Authorization:    `Bearer ${BMC_INTEGRATION_KEY}`,
    "integration-id": BMC_INTEGRATION_ID,
    "Content-Type":   "application/json",
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
    temperature:           0,
    max_completion_tokens: 700,
  };

  const response = await fetch(url, {
    method:  "POST",
    headers,
    body:    JSON.stringify(payload),
    timeout: 10000,
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
// ─────────────────────────────────────────────────────────────

async function callGroqFallback(userPrompt) {
  if (!isGroqConfigured()) {
    throw new Error("GROQ_API_KEY not set — cannot use Groq fallback");
  }

  const payload = {
    model:           GROQ_MODEL,
    temperature:     0,
    max_tokens:      1500,
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
      Authorization:  `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Groq API HTTP ${response.status}: ${rawText}`);
  }

  const result  = JSON.parse(rawText);
  const content = result?.choices?.[0]?.message?.content?.trim();

  if (!content) throw new Error("Empty Groq response content");

  const clean  = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(clean);

  if (!parsed || !Array.isArray(parsed.hotspots)) {
    throw new Error("Invalid Groq JSON schema");
  }

  parsed.summary = `[Groq Fallback] ${parsed.summary || ""}`.trim();
  return parsed;
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// UPDATED: now filters by SLA threshold per line, not just top hotspots
// ─────────────────────────────────────────────────────────────

async function getOptimizationSuggestions(
  sourceCode,
  lineByLineResults,   // ← pass full lineByLineResults, not just hottestStatements
  metadata = {}
) {
  // Filter to only lines breaching the per-line SLA threshold
  const breachingLines = filterBreachingLines(
    lineByLineResults,
    metadata.slaThreshold
  );

  if (breachingLines.length === 0) {
    return {
      summary:  "No individual lines exceed the SLA threshold.",
      hotspots: [],
    };
  }

  console.log(
    `Lines breaching SLA threshold (${metadata.slaThreshold}s): ` +
    breachingLines.map(l => `line ${l.line} (${l.combined}s)`).join(", ")
  );

  const userPrompt = buildPrompt(sourceCode, breachingLines, metadata);

  // ── 1. Try BMC first ────────────────────────────────────────
  if (isBMCConfigured()) {
    try {
      const result = await callBMCLLM(userPrompt);
      console.log("AI optimization: BMC LLM succeeded.");
      return result;
    } catch (bmcError) {
      console.warn("BMC LLM unavailable, switching to Groq fallback:", bmcError.message);
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
  return fallbackSuggestions(breachingLines);
}

module.exports = { getOptimizationSuggestions, filterBreachingLines };
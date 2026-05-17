#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

// Adjust paths if your analyzers are in a different location
const { CobolAnalyzer } = require("../src/cobolAnalyzer");
const { FeatureExtractor } = require("../src/featureExtractor");
const { predict } = require("../src/cpuPredictor");
const { getOptimizationSuggestions } = require("../src/aiOptimizer");

const SLA_THRESHOLD = Number(process.env.SLA_THRESHOLD || 5.0);
const SESSION_THRESHOLD = Number(process.env.SESSION_THRESHOLD || 20.0);
const LINE_CPU_THRESHOLD = Number(process.env.LINE_CPU_THRESHOLD || 15);

// Keep only the feature groups visible in the dashboard
function slimFeatures(features) {
  if (!features) return {};

  return {
    codeMetrics: features.codeMetrics || {},
    loopAnalysis: features.loopAnalysis || {},
    fileIO: features.fileIO || {},
    controlFlow: features.controlFlow || {},
    sqlOperations: features.sqlOperations || {},
    operationsAndFunctions: features.operationsAndFunctions || {},
    // If you want program name available, uncomment this:
    // summary: { programId: features.summary?.programId },
  };
}

async function analyzeFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const analyzer = new CobolAnalyzer(source, filePath);

  const syntaxErrors = analyzer.validateSyntax?.() || [];
  const deadIssues = analyzer.detectDeadCode?.() || [];
  const features = analyzer.extractFeatures?.() || {};
  const isClean = syntaxErrors.length === 0;

  let mlResult = null;
  let lineByLineResults = [];
  let aiSummary = "";
  let breached = false;

  if (isClean) {
    const lp = features.loopAnalysis || {};
    const io = features.fileIO || {};
    const cf = features.controlFlow || {};
    const of = features.operationsAndFunctions || {};

    const fileIOCount =
      (io.open || 0) +
      (io.close || 0) +
      (io.read || 0) +
      (io.write || 0) +
      (io.rewrite || 0) +
      (io.delete || 0) +
      (io.start || 0);

    // Program-level prediction
    const programResp = await predict(
      {
        maxLoopDepth: lp.maxLoopDepth || 0,
        nestedLoopCount: lp.nestedLoopCount || 0,
        totalPerforms: lp.totalPerforms || 0,
        fileIOCount,
        ifCount: cf.ifStatements || 0,
        functionCalls: cf.callStatements || 0,
        arithmeticOps: of.totalArithmetic || 0,
      },
      "program"
    );

    if (programResp.success && programResp.prediction) {
      mlResult = programResp.prediction;
    } else {
      mlResult = { error: programResp.error || "Program prediction failed" };
    }

    const cpu = Number(mlResult?.cpu_time || 0);
    const session = Number(mlResult?.session_time || 0);
    const cpuBreached = cpu > SLA_THRESHOLD;
    const sessionBreached = session > SESSION_THRESHOLD;
    breached = cpuBreached || sessionBreached;

    // Statement-level prediction
    const extractor = new FeatureExtractor(
      { ...features, deadIssues },
      filePath,
      source
    );
    const rows =
      typeof extractor._statementRows === "function"
        ? extractor._statementRows()
        : [];

    for (const row of rows) {
      const resp = await predict(
        {
          statement_type: row[2],
          is_loop: row[3],
          loop_depth: row[4],
          is_arithmetic: row[5],
          is_io: row[6],
        },
        "statement"
      );
      const p = resp.success && resp.prediction ? resp.prediction : {};
      lineByLineResults.push({
        line: row[0],
        type: row[2],
        combined: p.combined || 0,
        attributed: p.attributed || 0,
        executed: p.executed || 0,
      });
    }

    if (breached) {
      const hot = lineByLineResults
        .filter((r) => Number(r.combined || 0) > LINE_CPU_THRESHOLD)
        .sort((a, b) => Number(b.combined || 0) - Number(a.combined || 0));

      if (hot.length > 0) {
        const riskyCode = hot.map((r) => ({
          line: r.line,
          type: r.type,
          combined: r.combined,
        }));
        const ai = await getOptimizationSuggestions(source, riskyCode, {
          programName: features?.summary?.programId || path.basename(filePath),
          programCpuTime: mlResult?.cpu_time ?? null,
          slaThreshold: SLA_THRESHOLD,
          slaStatus: breached ? "BREACHED" : "SAFE",
        });
        aiSummary =
          typeof ai === "string" ? ai : ai.summary || "No AI summary.";
      }
    }
  }

  return {
    file: filePath,
    syntaxErrors,
    deadIssues,
    // Only expose dashboard-visible groups
    features: slimFeatures(features),
    mlResult,
    lineByLineResults,
    aiSummary,
    breached,
  };
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node ci/runAnalysis.js <file1.cbl> [file2.cbl...]");
    process.exit(1);
  }

  const results = [];
  for (const f of files) {
    results.push(await analyzeFile(f));
  }

  console.log(JSON.stringify({ results }, null, 2));

  const anyBreached = results.some((r) => r.breached);
  process.exit(anyBreached ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("CI analysis failed:", err);
    process.exit(1);
  });
}
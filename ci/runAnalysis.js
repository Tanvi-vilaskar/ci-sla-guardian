"use strict";

const fs = require("fs");
const path = require("path");

const { CobolAnalyzer } = require("../src/cobolAnalyzer");
const { FeatureExtractor } = require("../src/featureExtractor");
const { predict } = require("../src/cpuPredictor");
const { getOptimizationSuggestions } = require("../src/aiOptimizer");

const SLA_THRESHOLD = Number(process.env.SLA_THRESHOLD || 5.0);
const SESSION_THRESHOLD = Number(
  process.env.SESSION_THRESHOLD || 20.0
);
const LINE_CPU_THRESHOLD = Number(
  process.env.LINE_CPU_THRESHOLD || 15
);

function slimFeatures(features) {
  if (!features) return {};

  return {
    codeMetrics: features.codeMetrics || {},
    loopAnalysis: features.loopAnalysis || {},
    fileIO: features.fileIO || {},
    controlFlow: features.controlFlow || {},
    sqlOperations: features.sqlOperations || {},
    operationsAndFunctions:
      features.operationsAndFunctions || {},
  };
}

async function analyzeFile(filePath) {
  let source = "";

  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return {
      file: filePath,
      syntaxErrors: [],
      deadIssues: [],
      features: {},
      mlResult: {
        error: `Failed to read file: ${e.message}`,
      },
      lineByLineResults: [],
      aiSummary: "",
      breached: false,
    };
  }

  const analyzer = new CobolAnalyzer(source, filePath);

  const syntaxErrors =
    analyzer.validateSyntax?.() || [];

  const deadIssues =
    analyzer.detectDeadCode?.() || [];

  const features =
    analyzer.extractFeatures?.() || {};

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

    try {
      const programResp = await predict(
        {
          maxLoopDepth: lp.maxLoopDepth || 0,
          nestedLoopCount:
            lp.nestedLoopCount || 0,
          totalPerforms:
            lp.totalPerforms || 0,
          fileIOCount,
          ifCount: cf.ifStatements || 0,
          functionCalls:
            cf.callStatements ??
            of.builtInFunctionCalls ??
            0,
          arithmeticOps:
            of.totalArithmetic || 0,
        },
        "program"
      );

      if (
        programResp &&
        programResp.success &&
        programResp.prediction
      ) {
        mlResult = programResp.prediction;
      } else {
        mlResult = {
          error:
            programResp?.error ||
            "Program prediction failed",
        };
      }
    } catch (e) {
      mlResult = {
        error: `Program prediction threw: ${e.message}`,
      };
    }

    const cpu = Number(
      mlResult?.cpu_time || 0
    );

    const session = Number(
      mlResult?.session_time || 0
    );

    const cpuBreached =
      cpu > SLA_THRESHOLD;

    const sessionBreached =
      session > SESSION_THRESHOLD;

    breached =
      cpuBreached || sessionBreached;

    try {
      const extractor =
        new FeatureExtractor(
          { ...features, deadIssues },
          filePath,
          source
        );

      const rows =
        typeof extractor._statementRows ===
        "function"
          ? extractor._statementRows()
          : [];

      for (const row of rows) {
        try {
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

          const p =
            resp &&
            resp.success &&
            resp.prediction
              ? resp.prediction
              : {};

          lineByLineResults.push({
            line: row[0],
            type: row[2],
            combined: p.combined || 0,
            attributed:
              p.attributed || 0,
            executed: p.executed || 0,
            error:
              resp && !resp.success
                ? resp.error
                : null,
          });
        } catch (e) {
          lineByLineResults.push({
            line: row[0],
            type: row[2],
            combined: 0,
            attributed: 0,
            executed: 0,
            error:
              `Statement prediction threw: ${e.message}`,
          });
        }
      }
    } catch (e) {
      lineByLineResults.push({
        line: 0,
        type: "INTERNAL",
        combined: 0,
        attributed: 0,
        executed: 0,
        error:
          `Statement-level analysis failed: ${e.message}`,
      });
    }

    if (breached) {
      const hot = lineByLineResults
        .filter(
          (r) =>
            Number(r.combined || 0) >
            LINE_CPU_THRESHOLD
        )
        .sort(
          (a, b) =>
            Number(b.combined || 0) -
            Number(a.combined || 0)
        );

      if (hot.length > 0) {
        const riskyCode = hot.map((r) => ({
          line: r.line,
          type: r.type,
          combined: r.combined,
        }));

        try {
          const ai =
            await getOptimizationSuggestions(
              source,
              riskyCode,
              {
                programName:
                  features.summary
                    ?.programId ||
                  path.basename(filePath),

                programCpuTime:
                  mlResult?.cpu_time ??
                  null,

                slaThreshold:
                  SLA_THRESHOLD,

                slaStatus: breached
                  ? "BREACHED"
                  : "SAFE",
              }
            );

          aiSummary =
            typeof ai === "string"
              ? ai
              : ai?.summary ||
                "No AI summary.";
        } catch (e) {
          aiSummary =
            `AI suggestions failed: ${e.message}`;
        }
      }
    }
  }

  return {
    file: filePath,
    syntaxErrors,
    deadIssues,
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
    console.error(
      "Usage: node ci/runAnalysis.js <file1.cbl>"
    );
    process.exit(1);
  }

  const results = [];

  for (const f of files) {
    try {
      const result =
        await analyzeFile(f);

      results.push(result);
    } catch (e) {
      results.push({
        file: f,
        syntaxErrors: [],
        deadIssues: [],
        features: {},
        mlResult: {
          error:
            `Fatal analyze error: ${e.message}`,
        },
        lineByLineResults: [],
        aiSummary: "",
        breached: false,
      });
    }
  }

  console.log(
    JSON.stringify({ results }, null, 2)
  );

  const anyBreached = results.some(
    (r) => r.breached
  );

  process.exit(anyBreached ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.log(
      JSON.stringify(
        {
          results: [
            {
              file: "CI-PIPELINE",
              syntaxErrors: [],
              deadIssues: [],
              features: {},
              mlResult: {
                error:
                  `Top-level failure: ${err.message}`,
              },
              lineByLineResults: [],
              aiSummary: "",
              breached: false,
            },
          ],
        },
        null,
        2
      )
    );

    process.exit(1);
  });
}
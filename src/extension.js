"use strict";

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

const { CobolAnalyzer } = require("./cobolAnalyzer");
const { FeatureExtractor } = require("./featureExtractor");
const { DashboardPanel } = require("./dashboardPanel");
const { predict } = require("./cpuPredictor");
const { getOptimizationSuggestions } = require("./aiOptimizer");

let diagnosticCollection;
const cache = new Map();
let lastAnalyzedDoc = null;

const DEFAULT_SLA_THRESHOLD = Number(process.env.SLA_THRESHOLD || 1.5);
const HIGH_THRESHOLD = Number(process.env.LINE_CPU_THRESHOLD || 30);

function activate(context) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("slaGuardian");
  context.subscriptions.push(diagnosticCollection);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!isCobol(doc)) return;
      lastAnalyzedDoc = doc;
      await runAnalysis(doc, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("slaGuardian.showDashboard", () => {
      const doc = getTargetDocument();
      if (!doc) {
        vscode.window.showWarningMessage("Open a COBOL file first.");
        return;
      }

      const result = cache.get(doc.uri.toString());
      if (!result) {
        vscode.window.showWarningMessage("No analysis result found for this file.");
        return;
      }

      DashboardPanel.createOrShow(context.extensionUri, result, doc.fileName);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("slaGuardian.extractFeatures", async () => {
      const doc = getTargetDocument();
      if (!doc) {
        vscode.window.showErrorMessage("No active COBOL file.");
        return;
      }
      await doExtract(doc, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("slaGuardian.passFeaturesToModelTraining", async () => {
      const doc = getTargetDocument();
      if (!doc) {
        vscode.window.showErrorMessage("No active COBOL file.");
        return;
      }
      await doPassToTraining(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("slaGuardian.clearDiagnostics", () => {
      diagnosticCollection.clear();
      cache.clear();
      lastAnalyzedDoc = null;
      vscode.window.showInformationMessage("SLA Guardian diagnostics cleared.");
    })
  );

  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  sb.text = "$(shield) Static SLA Guardian";
  sb.command = "slaGuardian.showDashboard";
  sb.show();
  context.subscriptions.push(sb);
}

function getTargetDocument() {
  const ed = vscode.window.activeTextEditor;
  return ed && isCobol(ed.document) ? ed.document : lastAnalyzedDoc;
}

async function runAnalysis(doc, context) {
  const result = await analyzeDocument(doc);
  cache.set(doc.uri.toString(), result);
  diagnosticCollection.set(doc.uri, result.diagnostics);
  DashboardPanel.createOrShow(context.extensionUri, result, doc.fileName);
}

async function analyzeDocument(doc) {
  const analyzer = new CobolAnalyzer(doc.getText(), doc.fileName);
  const syntaxErrors = analyzer.validateSyntax() || [];
  const deadIssues = analyzer.detectDeadCode() || [];

  const diagnostics = [
    ...syntaxErrors.map((e) =>
      makeDiag(doc, e.line, `[Syntax] ${e.message}`, vscode.DiagnosticSeverity.Error, e.code)
    ),
    ...deadIssues.map((d) =>
      makeDiag(doc, d.line, `[Dead Code] ${d.message}`, vscode.DiagnosticSeverity.Warning, d.code)
    ),
  ];

  const features = analyzer.extractFeatures() || {};
  const isClean = syntaxErrors.length === 0;

  let mlResult = null;
  let lineByLineResults = [];
  let aiSuggestions = { summary: "Analysis not executed.", hotspots: [] };
  let sla = {
    threshold: DEFAULT_SLA_THRESHOLD,
    predictedCpu: null,
    breached: false,
    breachBy: 0,
    status: "NOT_RUN",
  };

  if (isClean) {
    mlResult = await runProgramPrediction(features);
    lineByLineResults = await runStatementPredictions(features, deadIssues, doc);
    sla = evaluateSla(mlResult, DEFAULT_SLA_THRESHOLD);

    const highRiskStatements = lineByLineResults
      .filter((r) => Number(r.combined || 0) > HIGH_THRESHOLD)
      .sort((a, b) => Number(b.combined || 0) - Number(a.combined || 0));

    const riskyCode = extractRiskyCode(doc.getText(), highRiskStatements);

    if (sla.breached && riskyCode.length > 0) {
      aiSuggestions = await getOptimizationSuggestions(doc.getText(), riskyCode, {
        programName: features?.summary?.programId || path.basename(doc.fileName),
        programCpuTime: mlResult?.cpu_time ?? null,
        slaThreshold: DEFAULT_SLA_THRESHOLD,
        slaStatus: sla.status,
      });
    } else if (riskyCode.length === 0) {
      aiSuggestions = { summary: "No HIGH CPU-risk statements detected.", hotspots: [] };
    } else {
      aiSuggestions = {
        summary: "SLA threshold not breached. Optimization suggestions were not requested.",
        hotspots: [],
      };
    }
  }

  return {
    fileName: doc.fileName,
    analyzedAt: new Date().toISOString(),
    syntaxErrors,
    deadIssues,
    diagnostics,
    features,
    mlResult,
    lineByLineResults,
    aiSuggestions,
    sla,
    isClean,
    featuresExtracted: false,
    featuresPath: null,
  };
}

async function runProgramPrediction(features) {
  const io = features.fileIO || {};
  const fileIOCount =
    (io.open || 0) +
    (io.close || 0) +
    (io.read || 0) +
    (io.write || 0) +
    (io.rewrite || 0) +
    (io.delete || 0) +
    (io.start || 0);

  const response = await predict(
    {
      maxLoopDepth: features.loopAnalysis?.maxLoopDepth || 0,
      nestedLoopCount: features.loopAnalysis?.nestedLoopCount || 0,
      totalPerforms: features.loopAnalysis?.totalPerforms || 0,
      fileIOCount,
      ifCount: features.controlFlow?.ifStatements || 0,
      functionCalls: features.controlFlow?.callStatements || 0,
      arithmeticOps: features.operationsAndFunctions?.totalArithmetic || 0,
    },
    "program"
  );

  if (!response.success || response.error) {
    return { error: response.error || "Program prediction failed" };
  }

  return response.prediction;
}

async function runStatementPredictions(features, deadIssues, doc) {
  const extractor = new FeatureExtractor(
    { ...features, deadIssues },
    doc.fileName,
    doc.getText()
  );

  const statementRows = typeof extractor._statementRows === "function" ? extractor._statementRows() : [];
  const results = [];

  for (const row of statementRows) {
    const response = await predict(
      {
        statement_type: row[2],
        is_loop: row[3],
        loop_depth: row[4],
        is_arithmetic: row[5],
        is_io: row[6],
      },
      "statement"
    );

    const prediction = response.success && response.prediction ? response.prediction : {};

    results.push({
      line: row[0],
      program: row[1],
      type: row[2],
      isLoop: row[3],
      loopDepth: row[4],
      isArithmetic: row[5],
      isIO: row[6],
      isSQL: row[7],
      combined: prediction.combined || 0,
      attributed: prediction.attributed || 0,
      executed: prediction.executed || 0,
      cpu: prediction.cpu_time || 0,
      error: response.success ? null : response.error,
    });
  }

  return results;
}

function evaluateSla(mlResult, threshold) {
  const predictedCpu = Number(mlResult?.cpu_time || 0);
  const breached = predictedCpu > threshold;

  return {
    threshold,
    predictedCpu,
    breached,
    breachBy: breached ? Number((predictedCpu - threshold).toFixed(6)) : 0,
    status: breached ? "BREACHED" : "SAFE",
  };
}

function extractRiskyCode(sourceText, riskyRows) {
  const lines = sourceText.split(/\r?\n/);
  return (riskyRows || []).map((r) => ({
    line: r.line,
    type: r.type,
    combined: r.combined,
    attributed: r.attributed,
    executed: r.executed,
    code: lines[r.line - 1] || "",
  }));
}

async function doExtract(doc, context) {
  const result = cache.get(doc.uri.toString());
  if (!result || !result.isClean) {
    vscode.window.showErrorMessage("Fix syntax errors before extracting features.");
    return;
  }

  const cfg = vscode.workspace.getConfiguration("slaGuardian");
  const extractor = new FeatureExtractor(result.features, doc.fileName, doc.getText());

  try {
    const saved = await extractor.saveToFile(
  cfg.get("featureOutputPath") || cfg.get("outputPath") || "./output/sla_features"
);

    result.featuresExtracted = true;
    result.featuresPath = saved;
    cache.set(doc.uri.toString(), result);
    DashboardPanel.createOrShow(context.extensionUri, result, doc.fileName);
    vscode.window.showInformationMessage("Features extracted successfully.");
  } catch (error) {
    vscode.window.showErrorMessage(`Feature extraction failed: ${error.message}`);
  }
}

async function doPassToTraining(doc) {
  const result = cache.get(doc.uri.toString());
  if (!result || !result.isClean) {
    vscode.window.showErrorMessage("Fix syntax errors before passing to model training.");
    return;
  }

  const extractor = new FeatureExtractor(result.features, doc.fileName, doc.getText());

  try {
    const wf = vscode.workspace.workspaceFolders;
    const rootPath = wf && wf.length > 0 ? wf[0].uri.fsPath : path.dirname(doc.fileName);
    const datasetPath = path.join(rootPath, "augmented_dataset.csv");

    const programHeaders = extractor._programHeaders();
    const programRow = extractor._programRow();

    if (!fs.existsSync(datasetPath)) {
      fs.writeFileSync(datasetPath, `${programHeaders.join(",")}\n`, "utf8");
    }

    fs.appendFileSync(datasetPath, `${programRow.join(",")}\n`, "utf8");
    vscode.window.showInformationMessage(`Features appended to ${path.basename(datasetPath)}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to pass features: ${error.message}`);
  }
}

function makeDiag(doc, lineNum, msg, severity, code) {
  const targetLine = Math.max(0, Math.min(Number(lineNum || 0), doc.lineCount - 1));
  const line = doc.lineAt(targetLine);
  const range = new vscode.Range(
    targetLine,
    line.firstNonWhitespaceCharacterIndex,
    targetLine,
    line.text.length
  );

  const d = new vscode.Diagnostic(range, msg, severity);
  d.source = "SLA Guardian";
  if (code) d.code = code;
  return d;
}

function isCobol(doc) {
  const ext = doc.fileName.toLowerCase();
  return (
    doc.languageId === "cobol" ||
    ext.endsWith(".cbl") ||
    ext.endsWith(".cob") ||
    ext.endsWith(".cobol")
  );
}

function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}

module.exports = {
  activate,
  deactivate,
  analyzeDocument,
};

"use strict";

const vscode = require("vscode");

// ─── SLA THRESHOLDS ───────────────────────────────────────────────────────────
const SLA_THRESHOLDS = {
  cpu_time: 5.0,
  session_time: 20.0,
};

class DashboardPanel {
  static current = undefined;

  static createOrShow(extensionUri, result, fileName) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (DashboardPanel.current) {
      DashboardPanel.current._panel.reveal(column);
      DashboardPanel.current._update(result, fileName);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "slaGuardian",
      "COBOL SLA Guardian",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    DashboardPanel.current = new DashboardPanel(panel);
    DashboardPanel.current._update(result, fileName);
  }

  constructor(panel) {
    this._panel = panel;

    panel.onDidDispose(() => {
      DashboardPanel.current = undefined;
    });

    panel.webview.onDidReceiveMessage((msg) => {
      switch (msg.cmd) {
        case "extract":
          vscode.commands.executeCommand(
            "slaGuardian.extractFeatures"
          );
          break;

        case "trainModelFeatures":
          vscode.commands.executeCommand(
            "slaGuardian.passFeaturesToModelTraining"
          );
          break;

        case "problems":
          vscode.commands.executeCommand(
            "workbench.actions.view.problems"
          );
          break;
      }
    });
  }

  _update(result, fileName) {
    this._panel.title = "COBOL SLA Guardian";
    this._panel.webview.html = buildHtml(result, fileName);
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function v(val) {
  return Number.isFinite(Number(val)) ? Number(val) : 0;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function row(label, val) {
  return `
    <div class="metric-row">
      <span class="ml">${esc(label)}</span>
      <span class="mv">${v(val)}</span>
    </div>
  `;
}

function issueList(arr, type) {
  if (!arr || arr.length === 0) {
    return `<p class="none">No ${esc(type)} ✓</p>`;
  }

  return arr
    .map(
      (e) => `
      <div class="iss ${e.severity === "error" ? "ie" : "iw"}">
        <span class="ic">${esc(e.code || "")}</span>
        <span class="il">L${(e.line || 0) + 1}</span>
        <span class="im">${esc(e.message || "")}</span>
      </div>
    `
    )
    .join("");
}

// ─── BUILD HTML ───────────────────────────────────────────────────────────────

function buildHtml(result, fileName) {
  const baseName = (fileName || "").split(/[\\/]/).pop();

  if (!result) {
    return `
<!DOCTYPE html>
<html>
<body style="background:#0f1216;color:#e8e8e8;font-family:'Segoe UI',sans-serif;padding:2rem">
  <h2 style="color:#f47c3c;font-size:22px;font-weight:700">
    ⚡ COBOL SLA Guardian
  </h2>

  <p style="margin-top:12px;color:#b8bcc2">
    Save a COBOL file (Ctrl+S) to trigger analysis.
  </p>
</body>
</html>
`;
  }

  // ─── AI Suggestions ────────────────────────────────────────────────────────

  let suggestionsText = "";

  if (result.aiSuggestions) {
    if (typeof result.aiSuggestions === "string") {
      suggestionsText = result.aiSuggestions;
    } else if (
      typeof result.aiSuggestions.summary === "string"
    ) {
      suggestionsText = result.aiSuggestions.summary;
    }
  }

  const suggestionsHtml = suggestionsText
    ? `
      <div class="iss iw">
        <span class="im">
          ${suggestionsText.replace(/\n/g, "<br>")}
        </span>
      </div>
    `
    : `<p class="none">No AI suggestions available.</p>`;

  // ─── RESULT DATA ───────────────────────────────────────────────────────────

  const {
    syntaxErrors = [],
    deadIssues = [],
    features = {},
    mlResult = {},
    lineByLineResults = [],
    isClean,
    analyzedAt,
    featuresExtracted,
    featuresPath,
  } = result;

  const cm = features.codeMetrics || {};
  const sql = features.sqlOperations || {};
  const lp = features.loopAnalysis || {};
  const io = features.fileIO || {};
  const cf = features.controlFlow || {};
  const of = features.operationsAndFunctions || {};

  const hasPred =
    isClean && mlResult && !mlResult.error;

  const cpuTime = hasPred
    ? Number(mlResult.cpu_time || 0)
    : null;

  const waitPercent = hasPred
    ? Number(mlResult.wait_percent || 0)
    : null;

  const stretchTime = hasPred
    ? Number(mlResult.stretch_time || 0)
    : null;

  let sessionTime =
    hasPred && mlResult.session_time != null
      ? Number(mlResult.session_time)
      : null;

  if (hasPred && sessionTime === 0) {
    sessionTime = Number(
      ((cpuTime || 0) + (stretchTime || 0)).toFixed(6)
    );
  }

  const waitSeconds =
    waitPercent !== null && sessionTime !== null
      ? Number(
          ((waitPercent / 100) * sessionTime).toFixed(6)
        )
      : null;

  const cpuBreach =
    cpuTime !== null &&
    cpuTime > SLA_THRESHOLDS.cpu_time;

  const sessionBreach =
    sessionTime !== null &&
    sessionTime > SLA_THRESHOLDS.session_time;

  const anySLABreach =
    cpuBreach || sessionBreach;

  const totalLineCombined =
    lineByLineResults.reduce(
      (s, r) => s + Number(r.combined || 0),
      0
    );

  const LINE_COMBINED_THRESHOLD = 15;

  // ─── LINE TABLE ────────────────────────────────────────────────────────────

  const lineRowsHtml =
    lineByLineResults.length > 0
      ? lineByLineResults
          .map((r) => {
            const combinedVal = Number(
              r.combined || 0
            );

            const lb =
              anySLABreach &&
              combinedVal >
                LINE_COMBINED_THRESHOLD;

            return `
<tr class="${lb ? "line-breach" : ""}">
  <td class="td-line">${r.line}</td>

  <td class="td-type">
    <span class="stmt-badge">
      ${esc(r.type)}
    </span>
  </td>

  <td class="td-cpu ${
    lb ? "cpu-hot" : "cpu-ok"
  }">
    ${combinedVal.toFixed(2)}%
  </td>

  <td class="td-cpu" style="color:var(--muted)">
    ${Number(r.attributed || 0).toFixed(2)}%
  </td>

  <td class="td-cpu" style="color:var(--blue)">
    ${Number(r.executed || 0).toFixed(2)}%
  </td>

  <td>
    ${
      lb
        ? `<span class="breach-tag">⚠ HIGH</span>`
        : `<span class="ok-tag">✓ OK</span>`
    }
  </td>
</tr>
`;
          })
          .join("")
      : `
<tr>
  <td colspan="6" class="no-data">
    No statement predictions available.
  </td>
</tr>
`;

  // ─── HTML ──────────────────────────────────────────────────────────────────

  return `
<!DOCTYPE html>
<html lang="en">

<head>
<meta charset="UTF-8">

<meta http-equiv="Content-Security-Policy"
content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">

<style>

:root{
  --bg:#0f1216;
  --panel:#1a2030;
  --card:#1c2333;
  --border:#2a3548;

  --text:#edf1f5;
  --muted:#8a96a8;

  --orange:#f47c3c;
  --orange2:#ff9a57;

  --success:#3dd68c;
  --warn:#f5c542;
  --error:#ff5a5a;
  --blue:#4a9eff;

  --radius:14px;
}

*{
  box-sizing:border-box;
  margin:0;
  padding:0;
}

body{
  background:var(--bg);
  color:var(--text);
  font-family:'Segoe UI',sans-serif;
  padding:20px;
}

.hdr{
  display:flex;
  justify-content:space-between;
  align-items:center;

  padding:16px;

  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius);

  margin-bottom:16px;
}

.title{
  font-size:20px;
  font-weight:800;
}

.sub{
  color:var(--orange2);
  font-size:11px;
  margin-top:4px;
}

.filebar{
  display:flex;
  justify-content:space-between;
  align-items:center;

  background:var(--card);

  border:1px solid var(--border);
  border-radius:var(--radius);

  padding:12px 16px;
  margin-bottom:16px;
}

.sumbar{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:12px;

  margin-bottom:18px;
}

.sc{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius);

  padding:14px;
  text-align:center;
}

.sc-label{
  font-size:10px;
  color:var(--muted);
  margin-bottom:6px;
}

.sc-val{
  font-size:22px;
  font-weight:800;
}

.red{color:var(--error);}
.green{color:var(--success);}
.yellow{color:var(--warn);}
.orange{color:var(--orange2);}

.section-title{
  margin:22px 0 10px;
  font-size:12px;
  color:var(--orange2);
  font-weight:800;
  text-transform:uppercase;
}

.sla-banner{
  padding:16px;
  border-radius:var(--radius);
  margin-bottom:16px;
  font-weight:700;
}

.sla-banner.ok{
  background:rgba(61,214,140,.12);
  border:1px solid rgba(61,214,140,.3);
  color:var(--success);
}

.sla-banner.breach{
  background:rgba(255,90,90,.12);
  border:1px solid rgba(255,90,90,.3);
  color:var(--error);
}

.sla-cards{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  gap:14px;

  margin-bottom:18px;
}

.sla-card{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius);

  padding:18px;
}

.sla-val{
  font-size:34px;
  font-weight:900;
}

.grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(250px,1fr));
  gap:14px;
}

.card{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius);
}

.card-hdr{
  padding:12px 14px;
  border-bottom:1px solid var(--border);
  font-weight:800;
}

.card-body{
  padding:12px 14px;
}

.metric-row{
  display:flex;
  justify-content:space-between;

  padding:6px 0;
  border-bottom:1px solid rgba(255,255,255,.05);
}

.metric-row:last-child{
  border-bottom:none;
}

.ml{
  color:var(--muted);
}

.mv{
  font-weight:800;
}

.isec{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius);

  margin-top:16px;
}

.isec-hdr{
  padding:12px 14px;
  border-bottom:1px solid var(--border);
  font-weight:800;
}

.isec-body{
  padding:12px 14px;
}

.iss{
  padding:10px;
  border-radius:10px;
  margin-bottom:8px;
}

.ie{
  background:rgba(255,90,90,.10);
  border-left:3px solid var(--error);
}

.iw{
  background:rgba(245,197,66,.10);
  border-left:3px solid var(--warn);
}

.none{
  color:var(--success);
}

.actions{
  margin-top:18px;
  display:flex;
  gap:10px;
  flex-wrap:wrap;
}

.btn{
  border:none;
  padding:10px 18px;
  border-radius:10px;
  cursor:pointer;
  font-weight:700;
}

.btn-orange{
  background:var(--orange);
  color:white;
}

.btn-light{
  background:#293244;
  color:white;
}

.lbl-table-wrap{
  overflow:hidden;

  border-radius:var(--radius);
  border:1px solid var(--border);

  margin-top:10px;
}

table{
  width:100%;
  border-collapse:collapse;
}

th{
  background:rgba(244,124,60,.1);
  color:var(--muted);

  padding:12px;
  text-align:left;
}

td{
  padding:12px;
  border-top:1px solid rgba(255,255,255,.05);
}

.line-breach{
  background:rgba(255,90,90,.06);
}

.cpu-hot{
  color:var(--error);
}

.cpu-ok{
  color:var(--success);
}

.breach-tag{
  color:var(--error);
  font-weight:800;
}

.ok-tag{
  color:var(--success);
  font-weight:800;
}

.footer{
  margin-top:22px;
  color:var(--muted);
  font-size:11px;
}

</style>
</head>

<body>

<div class="hdr">
  <div>
    <div class="title">
      ⚡ COBOL SLA Guardian
    </div>

    <div class="sub">
      Static Analysis & Performance Prediction
    </div>
  </div>

  <div>
    🕐 ${new Date(
      analyzedAt || Date.now()
    ).toLocaleTimeString()}
  </div>
</div>

<div class="filebar">
  <div>
    📄 ${esc(baseName)}
  </div>

  <div style="color:var(--muted)">
    ${new Date(
      analyzedAt || Date.now()
    ).toLocaleString()}
  </div>
</div>

<div class="sumbar">

  <div class="sc">
    <div class="sc-label">Total Lines</div>
    <div class="sc-val">${cm.totalLines || 0}</div>
  </div>

  <div class="sc">
    <div class="sc-label">Code Lines</div>
    <div class="sc-val">${cm.codeLines || 0}</div>
  </div>

  <div class="sc">
    <div class="sc-label">Syntax Errors</div>
    <div class="sc-val ${
      syntaxErrors.length ? "red" : "green"
    }">
      ${syntaxErrors.length}
    </div>
  </div>

  <div class="sc">
    <div class="sc-label">Dead Code</div>
    <div class="sc-val ${
      deadIssues.length ? "yellow" : "green"
    }">
      ${deadIssues.length}
    </div>
  </div>

</div>

<div class="section-title">
  🤖 SLA Performance Prediction
</div>

${
  hasPred
    ? `
<div class="sla-banner ${
        anySLABreach ? "breach" : "ok"
      }">

  ${
    anySLABreach
      ? "🚨 SLA BREACH DETECTED"
      : "✅ All Metrics Within SLA"
  }

</div>

<div class="sla-cards">

  <div class="sla-card">
    <div>CPU Time</div>

    <div class="sla-val">
      ${cpuTime.toFixed(4)}s
    </div>
  </div>

  <div class="sla-card">
    <div>Session Time</div>

    <div class="sla-val">
      ${sessionTime.toFixed(4)}s
    </div>
  </div>

</div>
`
    : `
<div class="sla-banner breach">
  Prediction unavailable
</div>
`
}

<div class="section-title">
  📋 Statement-Level Prediction
</div>

<div class="lbl-table-wrap">

<table>

<thead>
<tr>
  <th>Line</th>
  <th>Statement</th>
  <th>Combined</th>
  <th>Attributed</th>
  <th>Executed</th>
  <th>Status</th>
</tr>
</thead>

<tbody>
${lineRowsHtml}
</tbody>

</table>

</div>

<div class="section-title">
  📊 Code Analysis
</div>

<div class="grid">

<div class="card">
  <div class="card-hdr">📏 Code Metrics</div>

  <div class="card-body">
    ${row("Total Lines", cm.totalLines)}
    ${row("Code Lines", cm.codeLines)}
    ${row("Comments", cm.commentLines)}
    ${row("Sections", cm.sections)}
  </div>
</div>

<div class="card">
  <div class="card-hdr">🔁 Loop Analysis</div>

  <div class="card-body">
    ${row("PERFORM", lp.totalPerforms)}
    ${row("Nested Loops", lp.nestedLoopCount)}
    ${row("Loop Depth", lp.maxLoopDepth)}
  </div>
</div>

<div class="card">
  <div class="card-hdr">🗄 SQL</div>

  <div class="card-body">
    ${row("SELECT", sql.select)}
    ${row("INSERT", sql.insert)}
    ${row("UPDATE", sql.update)}
    ${row("DELETE", sql.delete)}
  </div>
</div>

</div>

<div class="isec">
  <div class="isec-hdr">
    🔍 Syntax Errors (${syntaxErrors.length})
  </div>

  <div class="isec-body">
    ${issueList(syntaxErrors, "syntax errors")}
  </div>
</div>

<div class="isec">
  <div class="isec-hdr">
    💀 Dead Code (${deadIssues.length})
  </div>

  <div class="isec-body">
    ${issueList(deadIssues, "dead code")}
  </div>
</div>

<div class="isec">
  <div class="isec-hdr">
    🤖 AI Recommendations
  </div>

  <div class="isec-body">
    ${suggestionsHtml}
  </div>
</div>

${
  featuresExtracted
    ? `
<div class="isec">
  <div class="isec-body">
    ✅ Features extracted → ${esc(
      featuresPath || ""
    )}
  </div>
</div>
`
    : ""
}

<div class="actions">

<button
class="btn btn-orange"
${isClean ? "" : "disabled"}
onclick="vscode.postMessage({cmd:'extract'})">

🧬 Extract Features

</button>

<button
class="btn btn-orange"
${isClean ? "" : "disabled"}
onclick="vscode.postMessage({cmd:'trainModelFeatures'})">

🚀 Pass to Training

</button>

<button
class="btn btn-light"
onclick="vscode.postMessage({cmd:'problems'})">

📋 Problems Panel

</button>

</div>

<div class="footer">

⚡ COBOL SLA Guardian

</div>

<script>
const vscode = acquireVsCodeApi();
</script>

</body>
</html>
`;
}

module.exports = {
  DashboardPanel,
};
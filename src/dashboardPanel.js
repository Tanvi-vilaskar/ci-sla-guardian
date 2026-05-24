"use strict";
const vscode = require("vscode");

// ─── SLA THRESHOLDS (hardcoded) ──────────────────────────────────────────────
const SLA_THRESHOLDS = {
  cpu_time: 5.0,   // seconds — breach if predicted > this
  session_time: 20.0, // seconds — breach if predicted > this
};

class DashboardPanel {
  static current = undefined;

  static createOrShow(extensionUri, result, fileName) {
    const col = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (DashboardPanel.current) {
      DashboardPanel.current._panel.reveal(col);
      DashboardPanel.current._update(result, fileName);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "slaGuardian",
      "COBOL SLA Guardian",
      col,
      { enableScripts: true, retainContextWhenHidden: true }
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
          vscode.commands.executeCommand("slaGuardian.extractFeatures");
          break;
        case "trainModelFeatures":
          vscode.commands.executeCommand("slaGuardian.passFeaturesToModelTraining");
          break;
        case "problems":
          vscode.commands.executeCommand("workbench.actions.view.problems");
          break;
      }
    });
  }

  _update(result, fileName) {
    this._panel.title = "COBOL SLA Guardian";
    this._panel.webview.html = buildHtml(result, fileName);
  }
}

function v(val) {
  if (val === undefined || val === null) return 0;
  return typeof val === "number" ? val : 0;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function row(label, val) {
  return `<div class="metric-row"><span class="ml">${esc(label)}</span><span class="mv">${v(
    val
  )}</span></div>`;
}

function issueList(arr, type) {
  if (!arr || arr.length === 0) return `<p class="none">No ${esc(type)} ✓</p>`;
  return arr
    .map(
      (e) =>
        `<div class="iss ${e.severity === "error" ? "ie" : "iw"}">
      <span class="ic">${esc(e.code || "")}</span>
      <span class="il">L${(e.line || 0) + 1}</span>
      <span class="im">${esc(e.message || "")}</span>
    </div>`
    )
    .join("");
}

function buildHtml(result, fileName) {
  const baseName = (fileName || "").split(/[\\/]/).pop();

  if (!result) {
    return `<!DOCTYPE html><html><body style="background:#0f1216;color:#e8e8e8;font-family:'Segoe UI',sans-serif;padding:2rem">
      <h2 style="color:#f47c3c;font-size:22px;font-weight:700">⚡ COBOL SLA Guardian</h2>
      <p style="margin-top:12px;color:#b8bcc2">Save a COBOL file (Ctrl+S) to trigger analysis.</p>
    </body></html>`;
  }

  // ─── AI OPTIMIZATION SUGGESTIONS ─────────────────────────────────────────────
  let suggestionsText = "";
  if (result.aiSuggestions) {
    if (typeof result.aiSuggestions === "string") {
      suggestionsText = result.aiSuggestions;
    } else if (typeof result.aiSuggestions.summary === "string") {
      suggestionsText = result.aiSuggestions.summary;
    }
  }

  const suggestionsHtml = suggestionsText
    ? `<div class="iss iw">
         <span class="im">${suggestionsText.replace(/\n/g, "<br>")}</span>
       </div>`
    : `<p class="none">No AI suggestions available.</p>`;

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

  const hasPred = isClean && mlResult && !mlResult.error;
  const cpuTime = hasPred ? mlResult.cpu_time || 0 : null;
  const waitPercent = hasPred ? mlResult.wait_percent || 0 : null;
  const stretchTime = hasPred ? mlResult.stretch_time || 0 : null;
  let sessionTime = hasPred ? mlResult.session_time || 0 : null;

  if (hasPred && sessionTime === 0) {
    sessionTime = parseFloat(((cpuTime || 0) + (stretchTime || 0)).toFixed(6));
  }

  const waitSeconds =
    waitPercent !== null && sessionTime !== null
      ? parseFloat(((waitPercent / 100) * sessionTime).toFixed(6))
      : null;

  const cpuBreach = cpuTime !== null && cpuTime > SLA_THRESHOLDS.cpu_time;
  const sessionBreach =
    sessionTime !== null && sessionTime > SLA_THRESHOLDS.session_time;
  const anySLABreach = cpuBreach || sessionBreach;

  const totalLineCombined = lineByLineResults.reduce(
    (s, r) => s + (r.combined || 0),
    0
  );
  const LINE_COMBINED_THRESHOLD = 30; // % — COMBINED above this flags as HIGH

  const lineRowsHtml =
    lineByLineResults.length > 0
      ? lineByLineResults
          .map((r) => {
            const lb = (r.combined || 0) > LINE_COMBINED_THRESHOLD;
            const combined = (r.combined || 0).toFixed(2);
            const attributed = (r.attributed || 0).toFixed(2);
            const executed = (r.executed || 0).toFixed(2);
            return `<tr class="${lb ? "line-breach" : ""}">
          <td class="td-line">${r.line}</td>
          <td class="td-type"><span class="stmt-badge">${esc(r.type)}</span></td>
          <td class="td-cpu ${lb ? "cpu-hot" : "cpu-ok"}">${combined}%</td>
          <td class="td-cpu" style="color:var(--muted)">${attributed}%</td>
          <td class="td-cpu" style="color:var(--blue)">${executed}%</td>
          <td>${
            lb
              ? '<span class="breach-tag">⚠ HIGH</span>'
              : '<span class="ok-tag">✓ OK</span>'
          }</td>
        </tr>`;
          })
          .join("")
      : `<tr><td colspan="6" class="no-data">No statement predictions available.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
:root{
  --bg:#0f1216; --bg-2:#141920; --panel:#1a2030; --card:#1c2333; --card-2:#202840;
  --border:#2a3548; --border-soft:#232e42; --text:#edf1f5;
  --muted:#8a96a8; --muted-2:#68788c;
  --orange:#f47c3c; --orange-2:#ff9a57; --orange-dark:#d96528;
  --success:#3dd68c; --warn:#f5c542; --error:#ff5a5a;
  --blue:#4a9eff; --shadow:0 12px 32px rgba(0,0,0,.45); --radius:14px;
}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,Arial,sans-serif;font-size:13px;line-height:1.5;min-height:100vh;}
.hdr{padding:16px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;background:linear-gradient(90deg,rgba(244,124,60,.12),transparent 60%);position:sticky;top:0;z-index:100;}
.logo{width:5px;height:38px;border-radius:999px;background:linear-gradient(180deg,var(--orange-2),var(--orange),var(--orange-dark));flex-shrink:0;}
.hdr-text .title{font-size:18px;font-weight:800;color:#fff;letter-spacing:-.3px;}
.hdr-text .sub{font-size:10px;color:var(--orange-2);font-weight:700;text-transform:uppercase;letter-spacing:.8px;}
.hdr-right{margin-left:auto;}
.time-badge{font-size:10px;color:var(--muted);background:var(--panel);border:1px solid var(--border);padding:4px 10px;border-radius:20px;}
.body{padding:18px 22px 32px;}
.file-bar{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;margin-bottom:16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);flex-wrap:wrap;gap:8px;}
.fname{color:#fff;font-size:13px;font-weight:700;} .fname span{color:var(--orange-2);}
.pipe{display:flex;margin-bottom:18px;overflow:hidden;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);}
.ps{flex:1;padding:14px 10px;text-align:center;border-right:1px solid var(--border);}
.ps:last-child{border-right:none;}
.ps.ok{background:rgba(61,214,140,.07);} .ps.fail{background:rgba(255,90,90,.07);} .ps.locked{background:rgba(255,255,255,.02);}
.ps-icon{font-size:20px;display:block;margin-bottom:4px;}
.ps-label{font-size:10px;color:var(--muted-2);text-transform:uppercase;letter-spacing:.6px;}
.ps-name{font-size:12px;font-weight:700;color:#fff;margin:3px 0;}
.ps-status{font-size:11px;font-weight:700;margin-top:3px;}
.sumbar{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;}
.sc{flex:1;min-width:90px;padding:13px;text-align:center;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);}
.sc-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;}
.sc-val{font-size:20px;font-weight:900;color:#fff;}
.sc-val.red{color:var(--error);} .sc-val.yellow{color:var(--warn);} .sc-val.green{color:var(--success);} .sc-val.orange{color:var(--orange-2);}
.section-title{font-size:11px;font-weight:800;color:var(--orange-2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px;display:flex;align-items:center;gap:8px;}
.section-title::after{content:'';flex:1;height:1px;background:var(--border);}
.sla-banner{padding:14px 18px;border-radius:var(--radius);margin-bottom:14px;display:flex;align-items:center;gap:14px;font-weight:700;font-size:13px;}
.sla-banner.breach{background:rgba(255,90,90,.12);border:1px solid rgba(255,90,90,.4);color:var(--error);}
.sla-banner.ok{background:rgba(61,214,140,.10);border:1px solid rgba(61,214,140,.35);color:var(--success);}
.sla-banner-icon{font-size:24px;}
.sla-banner-text .main{font-size:14px;font-weight:800;}
.sla-banner-text .sub2{font-size:11px;font-weight:400;opacity:.8;margin-top:2px;}
.sla-cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;}
.sla-card{flex:1;min-width:150px;padding:20px;border-radius:var(--radius);text-align:center;background:linear-gradient(145deg,var(--card-2),var(--card));border:1px solid var(--border);box-shadow:var(--shadow);position:relative;overflow:hidden;}
.sla-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--orange),var(--orange-2));}
.sla-card.breached::before{background:linear-gradient(90deg,var(--error),#ff8a8a);}
.sla-card.safe::before{background:linear-gradient(90deg,var(--success),#7affc0);}
.sla-lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px;}
.sla-val{font-size:32px;font-weight:900;color:#fff;line-height:1;}
.sla-unit{font-size:13px;color:var(--muted-2);margin-left:3px;font-weight:600;}
.sla-threshold{font-size:10px;margin-top:6px;}
.sla-threshold.over{color:var(--error);} .sla-threshold.under{color:var(--success);}
.sla-status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px;}
.dot-breach{background:var(--error);} .dot-ok{background:var(--success);}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px;}
@media(max-width:980px){.grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:640px){.grid{grid-template-columns:1fr;}}
.card{background:linear-gradient(160deg,var(--card-2),var(--card));border:1px solid var(--border);border-radius:var(--radius);}
.card-hdr{padding:10px 14px;font-size:11px;font-weight:800;color:#fff;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:.6px;}
.card-body{padding:8px 14px;}
.metric-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-soft);}
.metric-row:last-child{border-bottom:none;}
.ml{color:var(--muted);font-size:12px;} .mv{color:#fff;font-weight:800;}
.isec{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;}
.isec-hdr{padding:10px 14px;font-size:11px;font-weight:800;color:#fff;border-bottom:1px solid var(--border);}
.isec-body{padding:10px 14px;}
.iss{display:flex;gap:10px;padding:8px 10px;border-radius:8px;margin-bottom:6px;font-size:12px;}
.ie{background:rgba(255,90,90,.10);border-left:3px solid var(--error);}
.iw{background:rgba(245,197,66,.10);border-left:3px solid var(--warn);}
.ic{color:var(--muted);min-width:58px;font-size:11px;font-weight:700;}
.il{color:var(--orange-2);min-width:48px;font-weight:700;}
.im{color:var(--text);flex:1;}
.none{color:var(--success);font-size:12px;padding:4px 0;font-weight:700;}
.extracted{background:rgba(61,214,140,.10);border:1px solid rgba(61,214,140,.28);border-radius:10px;padding:9px 14px;font-size:12px;color:#7affba;margin-bottom:10px;font-weight:700;}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;}
.btn{padding:9px 18px;border-radius:10px;border:none;font-size:12px;font-family:inherit;cursor:pointer;font-weight:700;transition:.15s;}
.btn:hover{filter:brightness(1.1);} .btn:disabled{opacity:.4;cursor:not-allowed;}
.btn-orange{background:linear-gradient(180deg,var(--orange-2),var(--orange),var(--orange-dark));color:#fff;}
.btn-light{background:linear-gradient(180deg,#242d3d,#1c2435);color:#e0e6f0;border:1px solid var(--border);}
.lbl-table-wrap{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:18px;}
.lbl-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
.lbl-total{font-size:11px;color:var(--muted);background:var(--panel);border:1px solid var(--border);padding:4px 12px;border-radius:20px;}
table{width:100%;border-collapse:collapse;}
thead tr{background:rgba(244,124,60,.10);border-bottom:1px solid var(--border);}
th{padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);}
tbody tr{border-bottom:1px solid var(--border-soft);transition:.15s;}
tbody tr:last-child{border-bottom:none;}
tbody tr:hover{background:rgba(255,255,255,.03);}
tbody tr.line-breach{background:rgba(255,90,90,.06);}
td{padding:10px 14px;}
.td-line{color:var(--orange-2);font-weight:700;font-family:monospace;font-size:12px;}
.stmt-badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(74,158,255,.15);color:var(--blue);border:1px solid rgba(74,158,255,.25);}
.td-cpu{font-family:monospace;font-size:12px;font-weight:700;}
.cpu-hot{color:var(--error);} .cpu-ok{color:var(--success);}
.breach-tag{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:800;background:rgba(255,90,90,.15);color:var(--error);border:1px solid rgba(255,90,90,.3);}
.ok-tag{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:800;background:rgba(61,214,140,.12);color:var(--success);border:1px solid rgba(61,214,140,.28);}
.no-data{text-align:center;padding:24px;color:var(--muted-2);}
.footer{margin-top:18px;padding-top:12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;color:var(--muted-2);font-size:10px;flex-wrap:wrap;gap:6px;}
.footer-brand{color:var(--orange);font-weight:700;}
@keyframes pulse-red{0%,100%{box-shadow:0 0 0 0 rgba(255,90,90,.4);}50%{box-shadow:0 0 0 8px rgba(255,90,90,0);}}
.pulse-breach{animation:pulse-red 2s infinite;}
</style>
</head>
<body>

<div class="hdr">
  <div class="logo"></div>
  <div class="hdr-text">
    <div class="title">⚡ COBOL SLA Guardian</div>
    <div class="sub">Static Analysis &amp; Performance Prediction</div>
  </div>
  <div class="hdr-right">
    <span class="time-badge">🕐 ${new Date(
      analyzedAt || Date.now()
    ).toLocaleTimeString()}</span>
  </div>
</div>

<div class="body">

  <div class="file-bar">
    <span class="fname">📄 <span>${esc(baseName)}</span></span>
    <span style="color:var(--muted);font-size:11px;">Analyzed: ${new Date(
      analyzedAt || Date.now()
    ).toLocaleString()}</span>
  </div>

  <div class="pipe">
    <div class="ps ${syntaxErrors.length === 0 ? "ok" : "fail"}">
      <span class="ps-icon">🔍</span>
      <div class="ps-label">Stage 1</div>
      <div class="ps-name">Syntax Check</div>
      <div class="ps-status" style="color:${
        syntaxErrors.length === 0 ? "var(--success)" : "var(--error)"
      }">
        ${
          syntaxErrors.length === 0
            ? "✓ Passed"
            : syntaxErrors.length + " Error(s)"
        }
      </div>
    </div>
    <div class="ps ${deadIssues.length > 0 ? "fail" : "ok"}">
      <span class="ps-icon">💀</span>
      <div class="ps-label">Stage 2</div>
      <div class="ps-name">Dead Code</div>
      <div class="ps-status" style="color:${
        deadIssues.length === 0 ? "var(--success)" : "var(--warn)"
      }">
        ${
          deadIssues.length === 0
            ? "✓ Clean"
            : deadIssues.length + " Warning(s)"
        }
      </div>
    </div>
    <div class="ps ${isClean ? "ok" : "locked"}">
      <span class="ps-icon">🧬</span>
      <div class="ps-label">Stage 3</div>
      <div class="ps-name">Feature Extraction</div>
      <div class="ps-status" style="color:${
        isClean ? "var(--success)" : "var(--warn)"
      }">
        ${
          isClean
            ? featuresExtracted
              ? "✓ Extracted"
              : "✓ Unlocked"
            : "🔒 Locked"
        }
      </div>
    </div>
    <div class="ps ${hasPred ? "ok" : "locked"}">
      <span class="ps-icon">🤖</span>
      <div class="ps-label">Stage 4</div>
      <div class="ps-name">ML Prediction</div>
      <div class="ps-status" style="color:${
        hasPred ? "var(--success)" : "var(--muted-2)"
      }">
        ${
          hasPred
            ? "✓ Complete"
            : mlResult && mlResult.error
            ? "⚠ Error"
            : "🔒 Locked"
        }
      </div>
    </div>
  </div>

  <div class="sumbar">
    <div class="sc"><div class="sc-label">Total Lines</div><div class="sc-val">${
      cm.totalLines || 0
    }</div></div>
    <div class="sc"><div class="sc-label">Code Lines</div><div class="sc-val">${
      cm.codeLines || 0
    }</div></div>
    <div class="sc"><div class="sc-label">Syntax Errors</div><div class="sc-val ${
      syntaxErrors.length > 0 ? "red" : "green"
    }">${syntaxErrors.length}</div></div>
    <div class="sc"><div class="sc-label">Dead Code</div><div class="sc-val ${
      deadIssues.length > 0 ? "yellow" : "green"
    }">${deadIssues.length}</div></div>
    <div class="sc"><div class="sc-label">SQL Blocks</div><div class="sc-val orange">${
      sql.totalSqlBlocks || 0
    }</div></div>
    <div class="sc"><div class="sc-label">Statements</div><div class="sc-val orange">${
      lineByLineResults.length
    }</div></div>
  </div>

  <!-- SLA PREDICTION SECTION -->
  <div class="section-title">🤖 SLA Performance Prediction</div>

  ${
    hasPred
      ? `
  <div class="sla-banner ${anySLABreach ? "breach pulse-breach" : "ok"}">
    <div class="sla-banner-icon">${anySLABreach ? "🚨" : "✅"}</div>
    <div class="sla-banner-text">
      <div class="main">${
        anySLABreach
          ? "SLA BREACH DETECTED"
          : "All Metrics Within SLA Thresholds"
      }</div>
      <div class="sub2">${
        anySLABreach
          ? (cpuBreach
              ? `CPU ${cpuTime.toFixed(4)}s exceeds ${
                  SLA_THRESHOLDS.cpu_time
                }s limit`
              : "") +
            (cpuBreach && sessionBreach ? " · " : "") +
            (sessionBreach
              ? `Session ${sessionTime.toFixed(4)}s exceeds ${
                  SLA_THRESHOLDS.session_time
                }s limit`
              : "")
          : `CPU ≤ ${SLA_THRESHOLDS.cpu_time}s · Session ≤ ${
              SLA_THRESHOLDS.session_time
            }s`
      }</div>
    </div>
  </div>

  <div class="sla-cards">
    <div class="sla-card ${cpuBreach ? "breached" : "safe"}">
      <div class="sla-lbl">Est. CPU Time</div>
      <div class="sla-val">${cpuTime.toFixed(
        4
      )}<span class="sla-unit">s</span></div>
      <div class="sla-threshold ${cpuBreach ? "over" : "under"}">
        <span class="sla-status-dot ${
          cpuBreach ? "dot-breach" : "dot-ok"
        }"></span>
        Threshold ${SLA_THRESHOLDS.cpu_time}s — ${
            cpuBreach ? "⚠ EXCEEDED" : "✓ Within limit"
          }
      </div>
    </div>
    <div class="sla-card ${sessionBreach ? "breached" : "safe"}">
      <div class="sla-lbl">Session Time</div>
      <div class="sla-val">${sessionTime.toFixed(
        4
      )}<span class="sla-unit">s</span></div>
      <div class="sla-threshold ${sessionBreach ? "over" : "under"}">
        <span class="sla-status-dot ${
          sessionBreach ? "dot-breach" : "dot-ok"
        }"></span>
        Threshold ${SLA_THRESHOLDS.session_time}s — ${
            sessionBreach ? "⚠ EXCEEDED" : "✓ Within limit"
          }
      </div>
    </div>
  </div>
  `
      : `
  <div style="padding:20px;text-align:center;color:var(--muted-2);background:var(--card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:18px;">
    ${
      isClean
        ? mlResult && mlResult.error
          ? `⚠ ML prediction error: ${esc(mlResult.error)}`
          : "⏳ Prediction pending…"
        : "🔒 Fix syntax errors to unlock SLA prediction."
    }
  </div>
  `
  }

  <!-- LINE-BY-LINE SECTION -->
  <div class="section-title">📋 Statement-Level Performance Prediction</div>
  <div class="lbl-header">
    <span style="font-size:12px;color:var(--muted);">
      COMBINED threshold: <strong style="color:var(--orange-2);">${LINE_COMBINED_THRESHOLD}%</strong>
      &nbsp;·&nbsp;
      <span style="color:var(--muted)">COMBINED</span> = total CPU share &nbsp;
      <span style="color:var(--muted)">ATTRIBUTED</span> = direct cost &nbsp;
      <span style="color:var(--blue)">EXECUTED</span> = actual runtime cost
    </span>
    ${
      lineByLineResults.length > 0
        ? `<span class="lbl-total">Avg COMBINED: <strong style="color:var(--orange-2);">${(
            totalLineCombined / lineByLineResults.length
          ).toFixed(2)}%</strong></span>`
        : ""
    }
  </div>
  <div class="lbl-table-wrap">
    <table>
      <thead><tr>
        <th>Line</th>
        <th>Statement</th>
        <th>COMBINED %</th>
        <th>ATTRIBUTED %</th>
        <th>EXECUTED %</th>
        <th>Status</th>
      </tr></thead>
      <tbody>${lineRowsHtml}</tbody>
    </table>
  </div>

  <!-- CODE ANALYSIS SECTION -->
  <div class="section-title">📊 Code Analysis</div>
  <div class="grid">
    <div class="card">
      <div class="card-hdr">📏 Code Metrics</div>
      <div class="card-body">
        ${row("Total Lines", cm.totalLines)}${row("Code Lines", cm.codeLines)}${row(
          "Comment Lines",
          cm.commentLines
        )}
        ${row("Blank Lines", cm.blankLines)}${row("Paragraphs", cm.paragraphs)}${row(
          "Sections",
          cm.sections
        )}${row("Divisions", cm.divisions)}
      </div>
    </div>
    <div class="card">
      <div class="card-hdr">🔁 Loop Analysis</div>
      <div class="card-body">
        ${row("Total PERFORMs", lp.totalPerforms)}${row(
          "PERFORM UNTIL",
          lp.performUntil
        )}${row("PERFORM TIMES", lp.performTimes)}
        ${row("PERFORM VARYING", lp.performVarying)}${row(
          "Max Loop Depth",
          lp.maxLoopDepth
        )}${row("Nested Loop Count", lp.nestedLoopCount)}${row(
          "Est. Iterations",
          lp.estIterations
        )}
      </div>
    </div>
    <div class="card">
      <div class="card-hdr">📁 File I/O</div>
      <div class="card-body">
        ${row("OPEN", io.open)}${row("CLOSE", io.close)}${row("READ", io.read)}
        ${row("WRITE", io.write)}${row("REWRITE", io.rewrite)}${row(
          "DELETE",
          io.delete
        )}${row("START", io.start)}
      </div>
    </div>
    <div class="card">
      <div class="card-hdr">🔀 Control Flow</div>
      <div class="card-body">
        ${row("IF Statements", cf.ifStatements)}${row(
          "EVALUATE Blocks",
          cf.evaluateBlocks
        )}${row("GO TO", cf.goTo)}
        ${row("CALL Statements", cf.callStatements)}${row(
          "EXIT Statements",
          cf.exitStatements
        )}${row("STOP RUN", cf.stopRun)}
      </div>
    </div>
    <div class="card">
      <div class="card-hdr">🗄️ SQL Operations</div>
      <div class="card-body">
        ${row("Total SQL Blocks", sql.totalSqlBlocks)}${row(
          "SELECT",
          sql.select
        )}${row("INSERT", sql.insert)}
        ${row("UPDATE", sql.update)}${row("DELETE", sql.delete)}
      </div>
    </div>
    <div class="card">
      <div class="card-hdr">➗ Arithmetic & Functions</div>
      <div class="card-body">
        ${row("ADD", of.add)}${row("SUBTRACT", of.subtract)}${row(
          "MULTIPLY",
          of.multiply
        )}
        ${row("DIVIDE", of.divide)}${row(
          "COMPUTE",
          of.compute
        )}${row("Total Arithmetic", of.totalArithmetic)}${row(
          "Built-in Calls",
          of.builtInFunctionCalls
        )}
      </div>
    </div>
  </div>

  <div class="isec">
    <div class="isec-hdr">🔍 Syntax Errors (${syntaxErrors.length})</div>
    <div class="isec-body">${issueList(syntaxErrors, "syntax errors")}</div>
  </div>
  <div class="isec" style="margin-top:12px;">
    <div class="isec-hdr">💀 Dead Code Warnings (${deadIssues.length})</div>
    <div class="isec-body">${issueList(deadIssues, "dead code issues")}</div>
  </div>

  <div class="isec">
    <div class="isec-hdr">🤖 AI Recommendations</div>
    <div class="isec-body">
      ${suggestionsHtml}
    </div>
  </div>

  ${
    featuresExtracted
      ? `<div class="extracted" style="margin-top:12px;">✅ Features extracted → ${esc(
          featuresPath || ""
        )}</div>`
      : ""
  }
  <div class="actions" style="margin-top:12px;">
    <button class="btn btn-orange" ${
      isClean ? "" : "disabled"
    } onclick="vscode.postMessage({cmd:'extract'})">🧬 Extract Features</button>
    <button class="btn btn-orange" ${
      isClean ? "" : "disabled"
    } onclick="vscode.postMessage({cmd:'trainModelFeatures'})">🚀 Pass to Model Training</button>
    <button class="btn btn-light" onclick="vscode.postMessage({cmd:'problems'})">📋 Open Problems Panel</button>
  </div>

  <div class="footer">
    <span>⚡ <span class="footer-brand">COBOL SLA Guardian</span></span>
    <span>SLA Thresholds: CPU &lt; ${
      SLA_THRESHOLDS.cpu_time
    }s · Session &lt; ${SLA_THRESHOLDS.session_time}s</span>
  </div>
</div>

<script>const vscode = acquireVsCodeApi();</script>
</body>
</html>`;
}

module.exports = { DashboardPanel };
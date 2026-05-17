"use strict";

const path = require("path");
const fs = require("fs");

class FeatureExtractor {
  constructor(features, fileName, sourceText = "") {
    this.features = features || {};
    this.fileName = fileName || "";
    this.sourceText = sourceText || "";
  }

  async saveToFile(outputDir) {
    const vscode = require("vscode");

    let resolvedDir;
    if (path.isAbsolute(outputDir)) {
      resolvedDir = outputDir;
    } else {
      const wf = vscode.workspace.workspaceFolders;
      resolvedDir =
        wf && wf.length > 0
          ? path.join(wf[0].uri.fsPath, outputDir)
          : path.join(path.dirname(this.fileName), outputDir);
    }

    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    const statementCsv = path.join(resolvedDir, "statement_features.csv");
    const programCsv = path.join(resolvedDir, "program_features.csv");

    const statementHeaders = this._statementHeaders();
    const statementRows = this._statementRows();
    const programHeaders = this._programHeaders();
    const programRow = this._programRow();

    if (!fs.existsSync(statementCsv)) {
      fs.writeFileSync(statementCsv, statementHeaders.join(",") + "\n", "utf8");
    }

    if (!fs.existsSync(programCsv)) {
      fs.writeFileSync(programCsv, programHeaders.join(",") + "\n", "utf8");
    }

    if (statementRows.length > 0) {
      const lines = statementRows.map((r) => r.join(",")).join("\n") + "\n";
      fs.appendFileSync(statementCsv, lines, "utf8");
    }

    fs.appendFileSync(programCsv, programRow.join(",") + "\n", "utf8");

    return { statementCsv, programCsv };
  }

  _programRow() {
    const f = this.features;
    const lp = f.loopAnalysis || {};
    const sql = f.sqlOperations || {};
    const io = f.fileIO || {};
    const cf = f.controlFlow || {};
    const of = f.operationsAndFunctions || {};
    const s = f.summary || {};

    return [
      this._safeCsv(s.programId || this._inferProgramId()),
      lp.maxLoopDepth || 0,
      lp.nestedLoopCount || 0,
      lp.totalPerforms || 0,
      sql.totalSqlBlocks || 0,
      this._totalFileIO(io),
      cf.ifStatements || 0,
      cf.callStatements || 0,
      of.totalArithmetic || 0,
    ];
  }

  _programHeaders() {
    return [
      "Program_ID",
      "Max Loop Depth",
      "Nested Loop Count",
      "Loop_Statement Count",
      "SQL_Count",
      "File_IO_Count",
      "If_Count",
      "Function Calls",
      "No.OfArithmetic Operations",
    ];
  }

  _statementRows() {
    const rows = [];
    const lines = this.sourceText.split(/\r?\n/);

    const f = this.features;
    const lp = f.loopAnalysis || {};
    const s = f.summary || {};
    const programId = s.programId || this._inferProgramId();

    const deadParas = new Set(
      (f.deadIssues || [])
        .filter((d) => d.code === "DC001")
        .map((d) => {
          const m = d.message && d.message.match(/Paragraph '([^']+)'/);
          return m ? m[1].toUpperCase() : null;
        })
        .filter(Boolean)
    );

    let skipPara = false;
    const lineDepthMap = lp.lineDepthMap || {};
    const lineInsideLoop = lp.lineInsideLoop || {};

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const lineNumber = i + 1;
      const line = rawLine.toUpperCase().trim();

      if (!line) continue;
      if (this._isComment(rawLine)) continue;

      const paraMatch = rawLine.match(/^\s{7}([A-Z][A-Z0-9-]*)\.?\s*$/i);
      if (
        paraMatch &&
        !/\b(DIVISION|SECTION|PROCEDURE|DATA|WORKING-STORAGE|FILE|LINKAGE)\b/i.test(rawLine)
      ) {
        const currentPara = paraMatch[1].toUpperCase();
        skipPara = deadParas.has(currentPara);
        continue;
      }

      if (skipPara) continue;

      let statementType = null;
      let isSql = 0;

      if (/\bEXEC\s+SQL\b/.test(line)) {
        statementType = "SQL";
        isSql = 1;
      } else if (/\bCOMPUTE\b/.test(line)) statementType = "COMPUTE";
      else if (/\bEVALUATE\b/.test(line)) statementType = "EVALUATE";
      else if (/\bIF\b/.test(line) && !/\bEND-IF\b/.test(line)) statementType = "IF";
      else if (/\bDISPLAY\b/.test(line)) statementType = "DISPLAY";
      else if (/\bSTRING\b/.test(line)) statementType = "STRING";
      else if (/\bMOVE\b/.test(line)) statementType = "MOVE";
      else if (/\bADD\b/.test(line)) statementType = "ADD";
      else if (/\bSUBTRACT\b/.test(line)) statementType = "SUBTRACT";
      else if (/\bMULTIPLY\b/.test(line)) statementType = "MULTIPLY";
      else if (/\bDIVIDE\b/.test(line)) statementType = "DIVIDE";
      else if (/\bOPEN\b/.test(line)) statementType = "OPEN";
      else if (/\bCLOSE\b/.test(line)) statementType = "CLOSE";
      else if (
        /^\s*PERFORM\b/.test(line) &&
        (/\bPERFORM\s+VARYING\b/.test(line) ||
          /\bPERFORM\b.*\bUNTIL\b/.test(line) ||
          /\bPERFORM\b.*\bTIMES\b/.test(line) ||
          /^PERFORM\s*$/.test(line))
      ) {
        statementType = "PERFORM";
      }

      if (!statementType) continue;

      const perLineDepth =
        lineDepthMap[i] !== undefined ? lineDepthMap[i] : lp.maxLoopDepth || 0;
      const perLineInLoop = lineInsideLoop[i] !== undefined ? lineInsideLoop[i] : 1;

      rows.push([
        lineNumber,
        this._safeCsv(programId),
        this._safeCsv(statementType),
        this._isLoopStatement(line) ? 1 : perLineInLoop,
        perLineDepth,
        this._isArithmeticStatement(statementType) ? 1 : 0,
        this._isIOStatement(statementType) ? 1 : 0,
        isSql || (this._isSQLStatement(statementType) ? 1 : 0),
      ]);
    }

    return rows;
  }

  _statementHeaders() {
    return [
      "Line",
      "Program",
      "Statement",
      "Loop",
      "Loop Depth",
      "Arithmetic",
      "IO",
      "SQL",
    ];
  }

  _inferProgramId() {
    if (!this.fileName) return "UNKNOWN";
    return path.basename(this.fileName, path.extname(this.fileName)).toUpperCase();
  }

  _isComment(line) {
    if (!line) return false;
    if (/^\s*\*>/.test(line)) return true;
    if (line.length >= 7) {
      const col7 = line[6];
      if (col7 === "*" || col7 === "/") return true;
    }
    return false;
  }

  _isLoopStatement(line) {
    if (!/^\s*PERFORM\b/.test(line)) return false;
    return (
      /\bPERFORM\s+VARYING\b/.test(line) ||
      /\bPERFORM\b.*\bUNTIL\b/.test(line) ||
      /\bPERFORM\b.*\bTIMES\b/.test(line) ||
      /^PERFORM\s*$/.test(line)
    );
  }

  _isArithmeticStatement(statementType) {
    return ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "COMPUTE"].includes(statementType);
  }

  _isIOStatement(statementType) {
    return ["OPEN", "CLOSE", "READ", "WRITE", "REWRITE", "DELETE"].includes(statementType);
  }

  _isSQLStatement(statementType) {
    return statementType === "SQL";
  }

  _totalFileIO(io) {
    return (
      (io.open || 0) +
      (io.close || 0) +
      (io.read || 0) +
      (io.write || 0) +
      (io.rewrite || 0) +
      (io.delete || 0) +
      (io.start || 0)
    );
  }

  _safeCsv(value) {
    const s = String(value ?? "");
    return s.includes(",") ? `"${s}"` : s;
  }
}

module.exports = { FeatureExtractor };
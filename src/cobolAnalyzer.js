"use strict";

class CobolAnalyzer {
  constructor(sourceText, fileName) {
    this.source = sourceText;
    this.fileName = fileName;
    this.lines = sourceText.split("\n");
    this.upper = this.lines.map((l) => l.toUpperCase());
    this.keywordSet = new Set([
      "IDENTIFICATION",
      "ENVIRONMENT",
      "DATA",
      "PROCEDURE",
      "DIVISION",
      "SECTION",
      "PROGRAM-ID",
      "AUTHOR",
      "WORKING-STORAGE",
      "LOCAL-STORAGE",
      "LINKAGE",
      "FILE",
      "FD",
      "SD",
      "PERFORM",
      "MOVE",
      "COMPUTE",
      "ADD",
      "SUBTRACT",
      "MULTIPLY",
      "DIVIDE",
      "IF",
      "ELSE",
      "END-IF",
      "EVALUATE",
      "WHEN",
      "END-EVALUATE",
      "GO",
      "TO",
      "STOP",
      "RUN",
      "GOBACK",
      "EXIT",
      "PROGRAM",
      "READ",
      "WRITE",
      "REWRITE",
      "DELETE",
      "OPEN",
      "CLOSE",
      "CALL",
      "STRING",
      "UNSTRING",
      "INSPECT",
      "DISPLAY",
      "ACCEPT",
      "INITIALIZE",
      "SEARCH",
      "ALL",
      "VARYING",
      "AFTER",
      "UNTIL",
      "THRU",
      "THROUGH",
      "TIMES",
      "WITH",
      "TEST",
      "BEFORE",
      "EXEC",
      "SQL",
      "END-EXEC",
      "CICS",
      "NOT",
      "AND",
      "OR",
      "GREATER",
      "LESS",
      "EQUAL",
      "THAN",
      "TRUE",
      "FALSE",
      "HIGH-VALUES",
      "LOW-VALUES",
      "SPACES",
      "ZEROS",
      "SPACE",
      "ZERO",
      "PICTURE",
      "PIC",
      "VALUE",
      "REDEFINES",
      "OCCURS",
      "INDEXED",
      "BY",
      "DEPENDING",
      "BINARY",
      "PACKED-DECIMAL",
      "COMPUTATIONAL",
      "COMP",
      "USAGE",
      "IS",
      "FILLER",
      "COPY",
      "REPLACING",
      "SET",
      "SORT",
      "RETURN",
      "MERGE",
      "GIVING",
      "ALTER",
      "PROCEED",
      "END-PERFORM",
      "END-READ",
      "END-WRITE",
      "END-STRING",
      "END-UNSTRING",
      "END-CALL"
    ]);
  }

  validateSyntax() {
    const errors = [];
    const src = this.upper.join("\n");

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (!line) continue;
      if (/^\s*\*>/.test(line)) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^[*/]/.test(trimmed)) {
        if (line.length < 7 || (line[6] !== "*" && line[6] !== "/")) {
          errors.push({
            line: i,
            message: "Comment must start in column 7 (fixed COBOL format).",
            code: "SYN040",
          });
        }
      }
    }

    if (!/\bIDENTIFICATION\s+DIVISION\b/.test(src)) {
      errors.push({
        line: 0,
        message: "Missing IDENTIFICATION DIVISION.",
        code: "SYN001",
      });
    }

    if (!/\bPROCEDURE\s+DIVISION\b/.test(src)) {
      errors.push({
        line: 0,
        message: "Missing PROCEDURE DIVISION.",
        code: "SYN003",
      });
    }

    if (!/\bPROGRAM-ID\b/.test(src)) {
      errors.push({
        line: 0,
        message: "Missing PROGRAM-ID.",
        code: "SYN004",
      });
    }

    const hasDataDivision = /\bDATA\s+DIVISION\b/.test(src);
    const declaredVars = this._getDeclaredVariables();

    if (declaredVars.size > 0 && !hasDataDivision) {
      errors.push({
        line: 0,
        message: "DATA DIVISION required because variables are declared.",
        code: "SYN002",
      });
    }

    let ifDepth = 0;
    let inExecSql = false;
    const evalStack = [];
    let inProc = false;

    for (let i = 0; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const t = this.upper[i].trim();
      if (!t) continue;

      if (/\bPROCEDURE\s+DIVISION\b/.test(t)) {
        inProc = true;
        continue;
      }

      if (/\bEXEC\s+SQL\b/.test(t)) {
        if (inExecSql) {
          errors.push({
            line: i,
            message: "Nested EXEC SQL without END-EXEC.",
            code: "SYN010",
          });
        }
        inExecSql = true;
      }

      if (/\bEND-EXEC\b/.test(t)) {
        if (!inExecSql) {
          errors.push({
            line: i,
            message: "END-EXEC without EXEC SQL.",
            code: "SYN011",
          });
        }
        inExecSql = false;
      }

      if (!inProc) continue;

      if (/^\s*IF\b/.test(t)) ifDepth++;

      if (/\bEND-IF\b/.test(t)) {
        if (ifDepth === 0) {
          errors.push({
            line: i,
            message: "END-IF without matching IF.",
            code: "SYN020",
          });
        } else {
          ifDepth--;
        }
      }

      if (/^\s*EVALUATE\b/.test(t)) evalStack.push(i);

      if (/\bEND-EVALUATE\b/.test(t)) {
        if (evalStack.length === 0) {
          errors.push({
            line: i,
            message: "END-EVALUATE without matching EVALUATE.",
            code: "SYN021",
          });
        } else {
          evalStack.pop();
        }
      }

      if (/^\s*MOVE\b/.test(t) && !/\bTO\b/.test(t) && /\.\s*$/.test(t)) {
        errors.push({
          line: i,
          message: "MOVE statement missing TO clause.",
          code: "SYN030",
        });
      }

      if (/^\s*COMPUTE\b/.test(t) && !t.includes("=") && /\.\s*$/.test(t)) {
        errors.push({
          line: i,
          message: "COMPUTE missing = operator.",
          code: "SYN031",
        });
      }
    }

    if (inExecSql) {
      errors.push({
        line: this.lines.length - 1,
        message: "EXEC SQL not closed with END-EXEC.",
        code: "SYN012",
      });
    }

    for (let k = 0; k < ifDepth; k++) {
      errors.push({
        line: this.lines.length - 1,
        message: "IF block missing END-IF.",
        code: "SYN022",
      });
    }

    for (const el of evalStack) {
      errors.push({
        line: el,
        message: "EVALUATE missing END-EVALUATE.",
        code: "SYN023",
      });
    }

    return errors;
  }

  detectDeadCode() {
    const issues = [];
    const definedParas = this._getDefinedParagraphs();
    const calledParas = this._getCalledParagraphs();
    const entryPoint = this._getEntryPoint(definedParas);

    for (const [name, lineNum] of definedParas) {
      if (name === entryPoint) continue;
      if (!calledParas.has(name) && !this._isComment(lineNum)) {
        issues.push({
          line: lineNum,
          message: `Paragraph '${name}' is never performed/called.`,
          code: "DC001",
          severity: "warning",
          type: "unreferencedParagraph",
          name,
        });
      }
    }

    const declaredVars = this._getDeclaredVariables();
    const usedVars = this._getUsedVariables();
    for (const [varName, lineNum] of declaredVars) {
      if (!usedVars.has(varName)) {
        issues.push({
          line: lineNum,
          message: `Variable '${varName}' declared but never used.`,
          code: "DC002",
          severity: "warning",
          type: "unusedVariable",
          name: varName,
        });
      }
    }

    const proc = this._getProcedureLine();
    const terminators = ["STOP RUN", "GOBACK", "EXIT PROGRAM"];
    for (let i = proc; i < this.upper.length - 1; i++) {
      if (this._isComment(i)) continue;
      const t = this.upper[i].trim();

      for (const term of terminators) {
        if (t.includes(term)) {
          for (let j = i + 1; j < this.upper.length; j++) {
            const nt = this.upper[j].trim();
            if (!nt || this._isComment(j)) continue;
            if (/^[A-Z0-9][A-Z0-9-]*(\s+SECTION)?\s*\.\s*$/.test(nt)) break;

            issues.push({
              line: j,
              message: `Unreachable code after '${term}'.`,
              code: "DC003",
              severity: "warning",
              type: "unreachableCode",
            });
            break;
          }
        }
      }
    }

    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const t = this.upper[i].trim();

      const m = t.match(/\bIF\s+(\d+)\s*=\s*(\d+)\b/);
      if (m) {
        issues.push({
          line: i,
          message: `'IF ${m[1]} = ${m[2]}' is always ${m[1] === m[2] ? "TRUE" : "FALSE"} – dead branch.`,
          code: "DC004",
          severity: "warning",
          type: "impossibleBranch",
        });
      }

      const m2 = t.match(/\bIF\s+'([^']+)'\s*=\s*'([^']+)'/);
      if (m2 && m2[1] !== m2[2]) {
        issues.push({
          line: i,
          message: "Literal comparison always FALSE – dead branch.",
          code: "DC004",
          severity: "warning",
          type: "impossibleBranch",
        });
      }
    }

    return issues;
  }

  extractFeatures() {
    const u = this.upper;
    const lines = this.lines;
    const proc = this._getProcedureLine();

    const totalLines = lines.length;
    const commentLines = lines.filter((_, i) => this._isComment(i)).length;
    const blankLines = lines.filter((l) => !l.trim()).length;
    const codeLines = totalLines - commentLines - blankLines;
    const paragraphs = this._getDefinedParagraphs().size;
    const sections = u.filter((l) => /\b[\w-]+\s+SECTION\s*\.\s*$/.test(l.trim())).length;
    const divisions = u.filter((l) => /\bDIVISION\b/.test(l)).length;

    const db2Stats = this._getDb2QueryStats(proc);

    const loopStats = this._analyzeLoops(proc);
    const totalPerforms = loopStats.totalPerforms;
    const performUntil = loopStats.performUntil;
    const performTimes = loopStats.performTimes;
    const performVarying = loopStats.performVarying;
    const maxLoopDepth = loopStats.maxLoopDepth;
    const nestedLoopCount = loopStats.nestedLoopCount || 0;
    const estIterations = loopStats.estIterations;

    const ioOpen = u.filter((l, i) => i >= proc && !this._isComment(i) && /^OPEN\b/.test(l.trim())).length;
    const ioClose = u.filter((l, i) => i >= proc && !this._isComment(i) && /^CLOSE\b/.test(l.trim())).length;
    const ioRead = u.filter((l, i) => i >= proc && !this._isComment(i) && /^READ\b/.test(l.trim()) && !/^END-READ\b/.test(l.trim())).length;
    const ioWrite = u.filter((l, i) => i >= proc && !this._isComment(i) && /^WRITE\b/.test(l.trim()) && !/^END-WRITE\b/.test(l.trim())).length;
    const ioRewrite = u.filter((l, i) => i >= proc && !this._isComment(i) && /^REWRITE\b/.test(l.trim())).length;
    const ioDelete = u.filter((l, i) => i >= proc && !this._isComment(i) && /^DELETE\b/.test(l.trim()) && !/\bFROM\b/.test(l.trim())).length;
    const ioStart = u.filter((l, i) => i >= proc && !this._isComment(i) && /^START\b/.test(l.trim())).length;

    const ifStatements = u.filter((l, i) => i >= proc && /^\s*IF\b/.test(l)).length;
    const evaluateBlocks = u.filter((l, i) => i >= proc && /^\s*EVALUATE\b/.test(l)).length;
    const goTo = u.filter((l, i) => i >= proc && /\bGO\s+TO\b/.test(l)).length;
    const callStatements = u.filter((l, i) => i >= proc && /\bCALL\b/.test(l)).length;
    const exitStatements = u.filter((l, i) => i >= proc && /\bEXIT\b/.test(l)).length;
    const stopRun = u.filter((l, i) => i >= proc && /\bSTOP\s+RUN\b/.test(l)).length;

    const cyclomaticComplexity =
      1 + ifStatements + evaluateBlocks + performUntil + performVarying + goTo;

    const level01Items = u.filter((l, i) => i < proc && /^\s*01\s+/.test(l)).length;
    const level77Items = u.filter((l, i) => i < proc && /^\s*77\s+/.test(l)).length;
    const level88Conds = u.filter((l, i) => i < proc && /^\s*88\s+/.test(l)).length;
    const occursClause = u.filter((l, i) => i < proc && /\bOCCURS\b/.test(l)).length;
    const redefinesClauses = u.filter((l, i) => i < proc && /\bREDEFINES\b/.test(l)).length;
    const copyBooks = u.filter((l) => /^\s*COPY\b/.test(l)).length;
    const totalVariables = this._getDeclaredVariables().size;

    const arithmeticAdd = u.filter((l, i) => i >= proc && !this._isComment(i) && /^ADD\b/.test(l.trim())).length;
    const arithmeticSubtract = u.filter((l, i) => i >= proc && !this._isComment(i) && /^SUBTRACT\b/.test(l.trim())).length;
    const arithmeticMultiply = u.filter((l, i) => i >= proc && !this._isComment(i) && /^MULTIPLY\b/.test(l.trim())).length;
    const arithmeticDivide = u.filter((l, i) => i >= proc && !this._isComment(i) && /^DIVIDE\b/.test(l.trim())).length;
    const arithmeticCompute = u.filter((l, i) => i >= proc && !this._isComment(i) && /^COMPUTE\b/.test(l.trim())).length;
    const arithmeticMod = u.filter((l, i) => i >= proc && !this._isComment(i) && /\bMOD\b/.test(l)).length;

    const intrinsicStats = this._getIntrinsicFunctionStats(proc);

    return {
      codeMetrics: {
        totalLines,
        codeLines,
        commentLines,
        blankLines,
        paragraphs,
        sections,
        divisions,
      },
      sqlOperations: {
        totalSqlBlocks: db2Stats.totalSqlBlocks,
        select: db2Stats.select,
        insert: db2Stats.insert,
        update: db2Stats.update,
        delete: db2Stats.delete,
        cursors: db2Stats.cursors,
        joins: db2Stats.joins,
        fetch: db2Stats.fetch,
        openCursor: db2Stats.openCursor,
        closeCursor: db2Stats.closeCursor,
        whereClauses: db2Stats.whereClauses,
        orderBy: db2Stats.orderBy,
        groupBy: db2Stats.groupBy,
      },
      loopAnalysis: {
        totalPerforms,
        performUntil,
        performTimes,
        performVarying,
        maxLoopDepth,
        nestedLoopCount,
        estIterations,
        lineDepthMap: loopStats.lineDepthMap || {},
        lineInsideLoop: loopStats.lineInsideLoop || {},
        lineEstimatedExecutions: loopStats.lineEstimatedExecutions || {},
        loopWarnings: loopStats.loopWarnings || [],
      },
      fileIO: {
        open: ioOpen,
        close: ioClose,
        read: ioRead,
        write: ioWrite,
        rewrite: ioRewrite,
        delete: ioDelete,
        start: ioStart,
      },
      controlFlow: {
        ifStatements,
        evaluateBlocks,
        goTo,
        callStatements,
        exitStatements,
        stopRun,
        cyclomaticComplexity,
      },
      dataStructure: {
        level01Items,
        level77Items,
        level88Conditions: level88Conds,
        occursClause,
        redefinesClauses,
        copyBooks,
        totalVariables,
      },
      operationsAndFunctions: {
        add: arithmeticAdd,
        subtract: arithmeticSubtract,
        multiply: arithmeticMultiply,
        divide: arithmeticDivide,
        compute: arithmeticCompute,
        mod: arithmeticMod,
        totalArithmetic:
          arithmeticAdd +
          arithmeticSubtract +
          arithmeticMultiply +
          arithmeticDivide +
          arithmeticCompute +
          arithmeticMod,
        builtInFunctionCalls: intrinsicStats.totalFunctionCalls,
        uniqueBuiltInFunctions: intrinsicStats.uniqueFunctionCount,
      },
      summary: {
        complexityScore: 1 + ifStatements + evaluateBlocks + totalPerforms,
        computeOperations: u.filter((l, i) => i >= proc && /\bCOMPUTE\b/.test(l)).length,
        moveStatements: u.filter((l, i) => i >= proc && /\bMOVE\b/.test(l)).length,
        displayStatements: u.filter((l, i) => i >= proc && /\bDISPLAY\b/.test(l)).length,
        stringOperations: u.filter((l, i) => i >= proc && /\b(STRING|UNSTRING|INSPECT)\b/.test(l)).length,
        hasExecSql: db2Stats.totalSqlBlocks > 0,
        hasCicsCommands: /\bEXEC\s+CICS\b/.test(this.source.toUpperCase()),
        programId: this._getProgramId(),
      },
    };
  }

  _isComment(i) {
    const r = this.lines[i];
    if (!r) return false;

    if (r.length >= 7) {
      const indicator = r[6];
      if (indicator === "*" || indicator === "/" || indicator === "D") return true;
    }

    if (/^\s*\*>/.test(r)) return true;
    return false;
  }

  _getProcedureLine() {
    for (let i = 0; i < this.upper.length; i++) {
      if (/\bPROCEDURE\s+DIVISION\b/.test(this.upper[i])) return i;
    }
    return 0;
  }

  _getEntryPoint(map) {
    let minLine = Infinity;
    let name = null;
    for (const [n, l] of map) {
      if (l < minLine) {
        minLine = l;
        name = n;
      }
    }
    return name;
  }

  _getDefinedParagraphs() {
    const map = new Map();
    const proc = this._getProcedureLine();

    const invalidParagraphs = new Set([
      "END-IF",
      "END-EVALUATE",
      "END-PERFORM",
      "END-READ",
      "END-WRITE",
      "END-STRING",
      "END-UNSTRING",
      "END-CALL",
      "END-EXEC",
      "STOP",
      "RUN",
      "GOBACK",
      "EXIT",
      "PROGRAM",
    ]);

    for (let i = proc + 1; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const t = this.upper[i].trim();
      if (!t) continue;

      if (/^[A-Z0-9][A-Z0-9-]*(\s+SECTION)?\s*\.\s*$/.test(t)) {
        let name = t
          .replace(/\s+SECTION\s*\.$/, "")
          .replace(/\.\s*$/, "")
          .trim();

        if (name.startsWith("END-") || invalidParagraphs.has(name)) continue;
        if (this._isKeyword(name)) continue;
        if (name.length < 2) continue;

        map.set(name, i);
      }
    }

    return map;
  }

  _getCalledParagraphs() {
    const called = new Set();
    const proc = this._getProcedureLine();

    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const l = this.upper[i].trim();
      if (!l) continue;

      const simplePerform = l.match(/^PERFORM\s+([A-Z][A-Z0-9-]*)\b(?!\s+VARYING\b|\s+UNTIL\b|\s+\d+\s+TIMES\b)/);
      if (simplePerform && !this._isKeyword(simplePerform[1])) {
        called.add(simplePerform[1]);
      }

      const thruPerform = l.match(/\bPERFORM\s+[A-Z][A-Z0-9-]*\s+(?:THRU|THROUGH)\s+([A-Z][A-Z0-9-]*)/);
      if (thruPerform && !this._isKeyword(thruPerform[1])) {
        called.add(thruPerform[1]);
      }

      const gotoMatch = l.match(/\bGO\s+TO\s+([A-Z][A-Z0-9-]*)/);
      if (gotoMatch && !this._isKeyword(gotoMatch[1])) {
        called.add(gotoMatch[1]);
      }
    }

    return called;
  }

  _getDeclaredVariables() {
    const map = new Map();
    const proc = this._getProcedureLine();
    const ignore = new Set(["FILLER"]);

    for (let i = 0; i < proc; i++) {
      if (this._isComment(i)) continue;
      const m = this.upper[i].match(/^\s*(\d{2})\s+([A-Z][A-Z0-9-]*)\s/);
      if (m) {
        const lvl = parseInt(m[1], 10);
        const name = m[2].trim();
        if (lvl >= 1 && lvl <= 77 && !ignore.has(name) && !this._isKeyword(name)) {
          map.set(name, i);
        }
      }
    }
    return map;
  }

  _analyzeLoops(proc) {
    const stats = {
      totalPerforms: 0,
      performUntil: 0,
      performTimes: 0,
      performVarying: 0,
      maxLoopDepth: 0,
      nestedLoopCount: 0,
      estIterations: 0,
      lineDepthMap: {},
      lineInsideLoop: {},
      lineEstimatedExecutions: {},
      loopWarnings: [],
    };

    const loopStack = [];

    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;

      const line = this.upper[i].trim();
      if (!line) continue;

      const currentDepth = loopStack.length;
      stats.lineDepthMap[i] = currentDepth;
      stats.lineInsideLoop[i] = currentDepth > 0 ? 1 : 0;

      let lineExecEstimate = 1;
      for (const loopInfo of loopStack) {
        lineExecEstimate *= loopInfo.iterations;
        if (!Number.isFinite(lineExecEstimate) || lineExecEstimate > 1e12) {
          lineExecEstimate = 1e12;
          break;
        }
      }
      stats.lineEstimatedExecutions[i] = currentDepth > 0 ? lineExecEstimate : 0;
      stats.estIterations = Math.max(stats.estIterations, stats.lineEstimatedExecutions[i]);

      const isEndPerform = /^END-PERFORM\b/.test(line);
      if (isEndPerform) {
        if (loopStack.length > 0) {
          loopStack.pop();
        }
        continue;
      }

      const isVarying = /\bPERFORM\b.*\bVARYING\b/.test(line);
      const isTimes = /\bPERFORM\b.*\bTIMES\b/.test(line);
      const isUntilOnly = /\bPERFORM\b.*\bUNTIL\b/.test(line) && !isVarying;

      const isParaCall =
        /^PERFORM\s+[A-Z][A-Z0-9-]*(\s+(THRU|THROUGH)\s+[A-Z][A-Z0-9-]*)?\s*\.?\s*$/.test(line) &&
        !isVarying &&
        !isTimes &&
        !isUntilOnly;

      if (/^PERFORM\b/.test(line) && !isParaCall) {
        stats.totalPerforms++;
      }

      const isLoop = isVarying || isTimes || isUntilOnly;
      if (!isLoop) continue;

      if (loopStack.length > 0) {
        stats.nestedLoopCount++;
      }

      let iterations = 100;
      let loopType = "UNTIL";

      if (isTimes) {
        loopType = "TIMES";
        stats.performTimes++;
        const m = line.match(/\b(\d+)\s+TIMES\b/);
        iterations = m ? parseInt(m[1], 10) : 100;
      } else if (isVarying) {
        loopType = "VARYING";
        stats.performVarying++;
        iterations = this._estimateVaryingIterations(i);
      } else if (isUntilOnly) {
        loopType = "UNTIL";
        stats.performUntil++;
        iterations = this._estimateUntilIterations(i);
      }

      if (!Number.isFinite(iterations) || iterations <= 0) {
        iterations = 100;
      }

      const controlVars = this._extractLoopControlVariables(i, loopType);
      for (const v of controlVars) {
        if (loopStack.some((loop) => loop.controlVars.includes(v))) {
          stats.loopWarnings.push({
            line: i,
            message: `Loop control variable '${v}' is reused in nested loops; iteration estimates are approximate.`,
            code: "LOOP001",
          });
        }
      }

      loopStack.push({
        line: i,
        type: loopType,
        iterations,
        controlVars,
      });

      stats.maxLoopDepth = Math.max(stats.maxLoopDepth, loopStack.length);
    }

    return stats;
  }

  _extractLoopControlVariables(start, loopType) {
    const vars = [];
    for (let i = start; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const line = this.upper[i].trim();
      if (!line) continue;
      if (i > start && /^END-PERFORM\b/.test(line)) break;

      if (loopType === "VARYING") {
        const main = line.match(/\bVARYING\s+([A-Z][A-Z0-9-]*)\b/);
        if (main) vars.push(main[1]);

        const afterMatches = [...line.matchAll(/\bAFTER\s+([A-Z][A-Z0-9-]*)\b/g)];
        for (const m of afterMatches) vars.push(m[1]);
      }
    }
    return [...new Set(vars)];
  }

  _getIntrinsicFunctionStats(proc) {
    let totalFunctionCalls = 0;
    const uniqueFns = new Set();

    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const line = this.upper[i];
      const matches = [...line.matchAll(/\bFUNCTION\s+([A-Z][A-Z0-9-]*)\b/g)];

      for (const m of matches) {
        totalFunctionCalls++;
        uniqueFns.add(m[1]);
      }
    }

    return {
      totalFunctionCalls,
      uniqueFunctionCount: uniqueFns.size,
    };
  }

  _estimateVaryingIterations(start) {
    let from = null;
    let by = 1;
    let untilValue = null;
    let operator = null;

    for (let i = start; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const line = this.upper[i].trim();
      if (!line) continue;
      if (i > start && /^END-PERFORM\b/.test(line)) break;

      const fromMatch = line.match(/\bFROM\s+(-?\d+)\b/);
      if (fromMatch && from === null) from = parseInt(fromMatch[1], 10);

      const byMatch = line.match(/\bBY\s+(-?\d+)\b/);
      if (byMatch && by === 1) by = parseInt(byMatch[1], 10);

      const untilMatch = line.match(/\bUNTIL\s+[A-Z0-9-]+\s*(>=|<=|>|<|=)\s*(-?\d+)\b/);
      if (untilMatch) {
        operator = untilMatch[1];
        untilValue = parseInt(untilMatch[2], 10);
        break;
      }
    }

    if (from === null || untilValue === null || !operator || by === 0) return 100;

    let iterations = 100;

    if (by > 0) {
      switch (operator) {
        case ">":
          iterations = Math.max(0, Math.ceil((untilValue - from + 1) / by));
          break;
        case ">=":
          iterations = Math.max(0, Math.ceil((untilValue - from) / by));
          break;
        case "=":
          iterations = Number.isInteger((untilValue - from) / by)
            ? Math.abs((untilValue - from) / by) + 1
            : 100;
          break;
        default:
          return 100;
      }
    } else {
      switch (operator) {
        case "<":
          iterations = Math.max(0, Math.ceil((from - untilValue + 1) / Math.abs(by)));
          break;
        case "<=":
          iterations = Math.max(0, Math.ceil((from - untilValue) / Math.abs(by)));
          break;
        case "=":
          iterations = Number.isInteger((untilValue - from) / by)
            ? Math.abs((untilValue - from) / by) + 1
            : 100;
          break;
        default:
          return 100;
      }
    }

    if (!Number.isFinite(iterations) || iterations <= 0) return 100;
    return iterations;
  }

  _estimateUntilIterations(start) {
    for (let i = start; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const line = this.upper[i].trim();
      if (!line) continue;
      if (/\bUNTIL\b/.test(line)) return 100;
      if (i > start && /^END-PERFORM\b/.test(line)) break;
    }
    return 100;
  }

  _getDb2QueryStats(proc) {
    const stats = {
      totalSqlBlocks: 0,
      select: 0,
      insert: 0,
      update: 0,
      delete: 0,
      cursors: 0,
      joins: 0,
      fetch: 0,
      openCursor: 0,
      closeCursor: 0,
      whereClauses: 0,
      orderBy: 0,
      groupBy: 0,
    };

    let inExecSql = false;
    let block = [];

    const processBlock = (sqlLines) => {
      if (!sqlLines.length) return;
      const sqlText = sqlLines.join(" ").replace(/\s+/g, " ").trim();

      stats.totalSqlBlocks++;
      if (/\bSELECT\b/.test(sqlText)) stats.select++;
      if (/\bINSERT\b/.test(sqlText)) stats.insert++;
      if (/\bUPDATE\b/.test(sqlText)) stats.update++;
      if (/\bDELETE\s+FROM\b/.test(sqlText)) stats.delete++;
      if (/\bDECLARE\b.*\bCURSOR\b/.test(sqlText)) stats.cursors++;
      if (/\b(INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|JOIN)\b/.test(sqlText)) stats.joins++;
      if (/\bFETCH\b/.test(sqlText)) stats.fetch++;
      if (/\bOPEN\s+[A-Z0-9-]+\b/.test(sqlText)) stats.openCursor++;
      if (/\bCLOSE\s+[A-Z0-9-]+\b/.test(sqlText)) stats.closeCursor++;
      if (/\bWHERE\b/.test(sqlText)) stats.whereClauses++;
      if (/\bORDER\s+BY\b/.test(sqlText)) stats.orderBy++;
      if (/\bGROUP\s+BY\b/.test(sqlText)) stats.groupBy++;
    };

    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const line = this.upper[i].trim();
      if (!line) continue;

      if (/\bEXEC\s+SQL\b/.test(line)) {
        inExecSql = true;
        block = [];
        const afterExec = line.split(/EXEC\s+SQL/i)[1];
        if (afterExec && afterExec.trim()) block.push(afterExec.trim());
        continue;
      }

      if (inExecSql) {
        if (/\bEND-EXEC\b/.test(line)) {
          const beforeEnd = line.split(/END-EXEC/i)[0];
          if (beforeEnd && beforeEnd.trim()) block.push(beforeEnd.trim());
          processBlock(block);
          inExecSql = false;
          block = [];
        } else {
          block.push(line);
        }
      }
    }

    return stats;
  }

  _getUsedVariables() {
    const used = new Set();
    const proc = this._getProcedureLine();

    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const tokens = this.upper[i].match(/[A-Z][A-Z0-9-]*/g) || [];
      for (const t of tokens) {
        if (!this._isKeyword(t)) used.add(t);
      }
    }

    return used;
  }

  _getProgramId() {
    for (const l of this.upper) {
      const m = l.match(/\bPROGRAM-ID\s*\.\s*([A-Z0-9-]+)/);
      if (m) return m[1];
    }
    return "UNKNOWN";
  }

  _isKeyword(w) {
    return this.keywordSet.has(w);
  }
}

module.exports = { CobolAnalyzer };
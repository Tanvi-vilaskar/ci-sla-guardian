"use strict";

class CobolAnalyzer {
  constructor(sourceText, fileName) {
    this.source = sourceText;
    this.fileName = fileName;
    this.lines = sourceText.split("\n");
    this.upper = this.lines.map((l) => l.toUpperCase());
  }

  // ═══════════════════════════════════════════════════
  // STAGE 1 – SYNTAX VALIDATION
  // ═══════════════════════════════════════════════════
  validateSyntax() {
    const errors = [];
    const src = this.upper.join("\n");

    // ═══════════════════════════════════════════════════
    // FIXED FORMAT: COLUMN-7 COMMENT VALIDATION
    // ═══════════════════════════════════════════════════
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (!line) continue;

      // Ignore free-format comments (*>)
      if (/^\s*\*>/.test(line)) continue;

      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) continue;

      // Check only lines that are intended as comments
      // (start with * or / after trimming)
      if (/^[*/]/.test(trimmed)) {
        // Must be in column 7 (index 6)
        if (line.length < 7 || (line[6] !== "*" && line[6] !== "/")) {
          errors.push({
            line: i,
            message: "Comment must start in column 7 (fixed COBOL format).",
            code: "SYN040",
          });
        }
      }
    }

    // Required divisions (DATA DIVISION handled separately now)
    if (!/\bIDENTIFICATION\s+DIVISION\b/.test(src))
      errors.push({
        line: 0,
        message: "Missing IDENTIFICATION DIVISION.",
        code: "SYN001",
      });

    if (!/\bPROCEDURE\s+DIVISION\b/.test(src))
      errors.push({
        line: 0,
        message: "Missing PROCEDURE DIVISION.",
        code: "SYN003",
      });

    if (!/\bPROGRAM-ID\b/.test(src))
      errors.push({ line: 0, message: "Missing PROGRAM-ID.", code: "SYN004" });

    // ✅ FIX: DATA DIVISION is optional unless variables exist
    const hasDataDivision = /\bDATA\s+DIVISION\b/.test(src);
    const declaredVars = this._getDeclaredVariables();

    if (declaredVars.size > 0 && !hasDataDivision) {
      errors.push({
        line: 0,
        message: "DATA DIVISION required because variables are declared.",
        code: "SYN002",
      });
    }

    let ifDepth = 0,
      inExecSql = false;
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

      // EXEC SQL / END-EXEC
      if (/\bEXEC\s+SQL\b/.test(t)) {
        if (inExecSql)
          errors.push({
            line: i,
            message: "Nested EXEC SQL without END-EXEC.",
            code: "SYN010",
          });
        inExecSql = true;
      }

      if (/\bEND-EXEC\b/.test(t)) {
        if (!inExecSql)
          errors.push({
            line: i,
            message: "END-EXEC without EXEC SQL.",
            code: "SYN011",
          });
        inExecSql = false;
      }

      if (!inProc) continue;

      // IF / END-IF
      if (/^\s*IF\b/.test(t)) ifDepth++;

      if (/\bEND-IF\b/.test(t)) {
        if (ifDepth === 0)
          errors.push({
            line: i,
            message: "END-IF without matching IF.",
            code: "SYN020",
          });
        else ifDepth--;
      }

      // EVALUATE / END-EVALUATE
      if (/^\s*EVALUATE\b/.test(t)) evalStack.push(i);

      if (/\bEND-EVALUATE\b/.test(t)) {
        if (evalStack.length === 0)
          errors.push({
            line: i,
            message: "END-EVALUATE without matching EVALUATE.",
            code: "SYN021",
          });
        else evalStack.pop();
      }

      // MOVE validation
      if (/^\s*MOVE\b/.test(t) && !/\bTO\b/.test(t) && /\.\s*$/.test(t))
        errors.push({
          line: i,
          message: "MOVE statement missing TO clause.",
          code: "SYN030",
        });

      // COMPUTE validation
      if (/^\s*COMPUTE\b/.test(t) && !t.includes("=") && /\.\s*$/.test(t))
        errors.push({
          line: i,
          message: "COMPUTE missing = operator.",
          code: "SYN031",
        });
    }

    // Final validations
    if (inExecSql)
      errors.push({
        line: this.lines.length - 1,
        message: "EXEC SQL not closed with END-EXEC.",
        code: "SYN012",
      });

    for (let k = 0; k < ifDepth; k++)
      errors.push({
        line: this.lines.length - 1,
        message: "IF block missing END-IF.",
        code: "SYN022",
      });

    for (const el of evalStack)
      errors.push({
        line: el,
        message: "EVALUATE missing END-EVALUATE.",
        code: "SYN023",
      });

    return errors;
  }

  // ═══════════════════════════════════════════════════
  // STAGE 2 – DEAD CODE DETECTION
  // ═══════════════════════════════════════════════════
  detectDeadCode() {
    const issues = [];
    const definedParas = this._getDefinedParagraphs();
    const calledParas = this._getCalledParagraphs();
    const entryPoint = this._getEntryPoint(definedParas);

    // 2a. Unreferenced paragraphs
    for (const [name, lineNum] of definedParas) {
      if (name === entryPoint) continue; // NEVER flag entry point
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

    // 2b. Unused variables
    const declaredVars = this._getDeclaredVariables();
    const usedVars = this._getUsedVariables();
    for (const [varName, lineNum] of declaredVars) {
      if (!usedVars.has(varName))
        issues.push({
          line: lineNum,
          message: `Variable '${varName}' declared but never used.`,
          code: "DC002",
          severity: "warning",
          type: "unusedVariable",
          name: varName,
        });
    }

    // 2c. Unreachable code after STOP RUN / GOBACK / EXIT PROGRAM
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

    // 2d. Impossible literal branches
    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const t = this.upper[i].trim();
      const m = t.match(/\bIF\s+(\d+)\s*=\s*(\d+)\b/);
      if (m)
        issues.push({
          line: i,
          message: `'IF ${m[1]} = ${m[2]}' is always ${m[1] === m[2] ? "TRUE" : "FALSE"} – dead branch.`,
          code: "DC004",
          severity: "warning",
          type: "impossibleBranch",
        });
      const m2 = t.match(/\bIF\s+'([^']+)'\s*=\s*'([^']+)'/);
      if (m2 && m2[1] !== m2[2])
        issues.push({
          line: i,
          message: `Literal comparison always FALSE – dead branch.`,
          code: "DC004",
          severity: "warning",
          type: "impossibleBranch",
        });
    }
    return issues;
  }

  // ═══════════════════════════════════════════════════
  // STAGE 3 – FEATURE EXTRACTION (all 6 panels)
  // ═══════════════════════════════════════════════════
  extractFeatures() {
    const u = this.upper,
      lines = this.lines;
    const proc = this._getProcedureLine();

    // ── Code Metrics ──────────────────────────────────────
    const totalLines = lines.length;
    const commentLines = lines.filter((_, i) => this._isComment(i)).length;
    const blankLines = lines.filter((l) => !l.trim()).length;
    const codeLines = totalLines - commentLines - blankLines;
    const paragraphs = this._getDefinedParagraphs().size;
    const sections = u.filter((l) =>
      /\b[\w-]+\s+SECTION\s*\.\s*$/.test(l.trim()),
    ).length;
    const divisions = u.filter((l) => /\bDIVISION\b/.test(l)).length;

    // ── SQL Operations ────────────────────────────────────
    const db2Stats = this._getDb2QueryStats(proc);

    const totalSqlBlocks = db2Stats.totalSqlBlocks;
    const sqlSelect = db2Stats.select;
    const sqlInsert = db2Stats.insert;
    const sqlUpdate = db2Stats.update;
    const sqlDelete = db2Stats.delete;
    const cursors = db2Stats.cursors;
    const joins = db2Stats.joins;

    // ── Loop Analysis ─────────────────────────────────────
    // const totalPerforms   = u.filter((l, i) => i >= proc && /\bPERFORM\b/.test(l)).length;
    // const performUntil    = u.filter((l, i) => i >= proc && /\bPERFORM\b.*\bUNTIL\b/.test(l)).length;
    // const performTimes    = u.filter((l, i) => i >= proc && /\bPERFORM\b.*\bTIMES\b/.test(l)).length;
    // const performVarying  = u.filter((l, i) => i >= proc && /\bPERFORM\b.*\bVARYING\b/.test(l)).length;
    // const maxLoopDepth    = this._nestedLoopDepth(proc);
    // const estIterations   = this._estIterations(proc);

   const loopStats = this._analyzeLoops(proc);

const totalPerforms   = loopStats.totalPerforms;
const performUntil    = loopStats.performUntil;
const performTimes    = loopStats.performTimes;
const performVarying  = loopStats.performVarying;
const maxLoopDepth    = loopStats.maxLoopDepth;
const nestedLoopCount = loopStats.nestedLoopCount || 0;
const estIterations   = loopStats.estIterations;

    // ── File I/O ──────────────────────────────────────────
    // ── File I/O ──────────────────────────────────────────
    // ── File I/O ──────────────────────────────────────────
    const ioOpen = u.filter(
      (l, i) => i >= proc && !this._isComment(i) && /^OPEN\b/.test(l.trim()),
    ).length;

    const ioClose = u.filter(
      (l, i) => i >= proc && !this._isComment(i) && /^CLOSE\b/.test(l.trim()),
    ).length;

    const ioRead = u.filter(
      (l, i) =>
        i >= proc &&
        !this._isComment(i) &&
        /^READ\b/.test(l.trim()) &&
        !/^END-READ\b/.test(l.trim()),
    ).length;

    const ioWrite = u.filter(
      (l, i) =>
        i >= proc &&
        !this._isComment(i) &&
        /^WRITE\b/.test(l.trim()) &&
        !/^END-WRITE\b/.test(l.trim()),
    ).length;

    const ioRewrite = u.filter(
      (l, i) => i >= proc && !this._isComment(i) && /^REWRITE\b/.test(l.trim()),
    ).length;

    const ioDelete = u.filter(
      (l, i) =>
        i >= proc &&
        !this._isComment(i) &&
        /^DELETE\b/.test(l.trim()) &&
        !/\bFROM\b/.test(l.trim()),
    ).length;

    const ioStart = u.filter(
      (l, i) => i >= proc && !this._isComment(i) && /^START\b/.test(l.trim()),
    ).length;

    // ── Control Flow ──────────────────────────────────────
    const ifStatements = u.filter(
      (l, i) => i >= proc && /^\s*IF\b/.test(l),
    ).length;
    const evaluateBlocks = u.filter(
      (l, i) => i >= proc && /^\s*EVALUATE\b/.test(l),
    ).length;
    const goTo = u.filter((l, i) => i >= proc && /\bGO\s+TO\b/.test(l)).length;
    const callStatements = u.filter(
      (l, i) => i >= proc && /\bCALL\b/.test(l),
    ).length;
    const exitStatements = u.filter(
      (l, i) => i >= proc && /\bEXIT\b/.test(l),
    ).length;
    const stopRun = u.filter(
      (l, i) => i >= proc && /\bSTOP\s+RUN\b/.test(l),
    ).length;
    const cyclomaticComplexity =
      1 + ifStatements + evaluateBlocks + performUntil + performVarying + goTo;

    // ── Data Structure ────────────────────────────────────
    const level01Items = u.filter(
      (l, i) => i < proc && /^\s*01\s+/.test(l),
    ).length;
    const level77Items = u.filter(
      (l, i) => i < proc && /^\s*77\s+/.test(l),
    ).length;
    const level88Conds = u.filter(
      (l, i) => i < proc && /^\s*88\s+/.test(l),
    ).length;
    const occursClause = u.filter(
      (l, i) => i < proc && /\bOCCURS\b/.test(l),
    ).length;
    const redefinesClauses = u.filter(
      (l, i) => i < proc && /\bREDEFINES\b/.test(l),
    ).length;
    const copyBooks = u.filter((l) => /^\s*COPY\b/.test(l)).length;
    const totalVariables = this._getDeclaredVariables().size;

    // ── Arithmetic Operations + Intrinsic Functions ─────────────────────
    // ── Arithmetic Operations + Built-in Functions ─────────────────────
    const arithmeticAdd = u.filter(
      (l, i) => i >= proc && !this._isComment(i) && /^ADD\b/.test(l.trim()),
    ).length;

    const arithmeticSubtract = u.filter(
      (l, i) =>
        i >= proc && !this._isComment(i) && /^SUBTRACT\b/.test(l.trim()),
    ).length;

    const arithmeticMultiply = u.filter(
      (l, i) =>
        i >= proc && !this._isComment(i) && /^MULTIPLY\b/.test(l.trim()),
    ).length;

    const arithmeticDivide = u.filter(
      (l, i) => i >= proc && !this._isComment(i) && /^DIVIDE\b/.test(l.trim()),
    ).length;

    const arithmeticCompute = u.filter(
      (l, i) => i >= proc && !this._isComment(i) && /^COMPUTE\b/.test(l.trim()),
    ).length;

    const arithmeticMod = u.filter(
      (l, i) => i >= proc && !this._isComment(i) && /\bMOD\b/.test(l),
    ).length;

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
        totalSqlBlocks,
        select: sqlSelect,
        insert: sqlInsert,
        update: sqlUpdate,
        delete: sqlDelete,
        cursors,
        joins,
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
  lineDepthMap:   loopStats.lineDepthMap   || {},
  lineInsideLoop: loopStats.lineInsideLoop || {},
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
        computeOperations: u.filter(
          (l, i) => i >= proc && /\bCOMPUTE\b/.test(l),
        ).length,
        moveStatements: u.filter((l, i) => i >= proc && /\bMOVE\b/.test(l))
          .length,
        displayStatements: u.filter(
          (l, i) => i >= proc && /\bDISPLAY\b/.test(l),
        ).length,
        stringOperations: u.filter(
          (l, i) => i >= proc && /\b(STRING|UNSTRING|INSPECT)\b/.test(l),
        ).length,
        hasExecSql: totalSqlBlocks > 0,
        hasCicsCommands: /\bEXEC\s+CICS\b/.test(this.source.toUpperCase()),
        programId: this._getProgramId(),
      },
    };
  }

  // ═══════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════
  _isComment(i) {
    const r = this.lines[i];
    if (!r) return false;

    // Fixed-format comment (column 7)
    if (r.length >= 7) {
      const indicator = r[6];
      if (indicator === "*" || indicator === "/") return true;

      // Optional: treat debug lines as comments
      if (indicator === "D") return true;
    }

    // Free-format comment
    if (/^\s*\*>/.test(r)) return true;

    return false;
  }

  _getProcedureLine() {
    for (let i = 0; i < this.upper.length; i++)
      if (/\bPROCEDURE\s+DIVISION\b/.test(this.upper[i])) return i;
    return 0;
  }

  _getEntryPoint(map) {
    let minLine = Infinity,
      name = null;
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

    // All control/terminator keywords that should NEVER be paragraphs
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

      // Match potential paragraph or section
      if (/^[A-Z0-9][A-Z0-9-]*(\s+SECTION)?\s*\.\s*$/.test(t)) {
        let name = t
          .replace(/\s+SECTION\s*\.$/, "")
          .replace(/\.\s*$/, "")
          .trim();

        // ❗ Reject END-* and known control keywords
        if (name.startsWith("END-") || invalidParagraphs.has(name)) continue;

        // ❗ Reject anything that is a COBOL keyword
        if (this._isKeyword(name)) continue;

        // ❗ Extra safety: ignore single-word statements accidentally matching
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
      const l = this.upper[i];
      let m;
      m = l.match(/\bPERFORM\s+([A-Z0-9][A-Z0-9-]*)/);
      if (m) called.add(m[1]);
      m = l.match(
        /\bPERFORM\s+[A-Z0-9][A-Z0-9-]*\s+(?:THRU|THROUGH)\s+([A-Z0-9][A-Z0-9-]*)/,
      );
      if (m) {
        called.add(m[1]);
      }
      m = l.match(/\bGO\s+TO\s+([A-Z0-9][A-Z0-9-]*)/);
      if (m) called.add(m[1]);
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
        const lvl = parseInt(m[1]);
        const name = m[2].trim();
        if (
          lvl >= 1 &&
          lvl <= 77 &&
          !ignore.has(name) &&
          !this._isKeyword(name)
        )
          map.set(name, i);
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
      lineDepthMap: {},   // lineIndex → loop depth AT that line (for per-statement features)
      lineInsideLoop: {}, // lineIndex → 1 if inside any loop, 0 if not
    };

    let depth = 0;

    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;

      const line = this.upper[i].trim();
      if (!line) continue;

      // Record current depth BEFORE processing this line's PERFORM
      // (so the PERFORM VARYING itself gets the depth it STARTS at, not after entering)
      stats.lineDepthMap[i]    = depth;
      stats.lineInsideLoop[i]  = depth > 0 ? 1 : 0;

      // Detect loop forms
      const isVarying = /\bPERFORM\s+VARYING\b/.test(line);
      const isTimes   = /\bPERFORM\b.*\bTIMES\b/.test(line);
      const isUntil   = /\bPERFORM\b.*\bUNTIL\b/.test(line);

      // Inline PERFORM block (no paragraph name directly after PERFORM,
      // or followed by VARYING/UNTIL/TIMES) — has a matching END-PERFORM
      // Simple para call pattern: PERFORM PARA-NAME. or PERFORM PARA-NAME THRU ...
      // We detect a para call as: PERFORM followed by an identifier (not a keyword)
      // that is NOT one of the loop keywords, ending with a period or THRU/THROUGH
      const isParaCall = /^PERFORM\s+[A-Z][A-Z0-9-]*(\s+(THRU|THROUGH)\s+[A-Z][A-Z0-9-]*)?\s*\.?\s*$/.test(line)
                      && !isVarying && !isTimes && !isUntil;

      // Count only loop-type PERFORMs, not simple para calls
      if (/^PERFORM\b/.test(line) && !/^END-PERFORM\b/.test(line) && !isParaCall) {
        stats.totalPerforms++;
      }

      const isLoop = isVarying || isTimes || isUntil;

      if (isLoop) {
        // Nested loop count = loop started when already inside another loop
        if (depth > 0) {
          stats.nestedLoopCount++;
        }

        depth++;
        stats.maxLoopDepth = Math.max(stats.maxLoopDepth, depth);

        if (isVarying) stats.performVarying++;
        if (isTimes) stats.performTimes++;
        if (isUntil) stats.performUntil++;

        // Estimated iterations
        if (isTimes) {
          const m = line.match(/\b(\d+)\s+TIMES\b/);
          if (m) {
            stats.estIterations += parseInt(m[1], 10);
          } else {
            stats.estIterations += 1;
          }
        } else if (isVarying) {
          const est = this._estimateVaryingIterations(i);
          stats.estIterations += est;
        } else if (isUntil) {
          const est = this._estimateUntilIterations(i);
          stats.estIterations += est;
        }
      }

      if (/^END-PERFORM\b/.test(line)) {
        depth = Math.max(0, depth - 1);
      }
    }

    return stats;
  }

  _getIntrinsicFunctionStats(proc) {
    let totalFunctionCalls = 0;
    const uniqueFns = new Set();

    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;

      const line = this.upper[i];

      // Matches: FUNCTION REVERSE, FUNCTION LENGTH, FUNCTION CURRENT-DATE, etc.
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

      // FROM n
      const fromMatch = line.match(/\bFROM\s+(\d+)\b/);
      if (fromMatch) from = parseInt(fromMatch[1], 10);

      // BY n
      const byMatch = line.match(/\bBY\s+(\d+)\b/);
      if (byMatch) by = parseInt(byMatch[1], 10);

      // UNTIL var > n  OR >= OR < OR <=
      const untilMatch = line.match(
        /\bUNTIL\s+[A-Z0-9-]+\s*(>=|<=|>|<|=)\s*(\d+)\b/,
      );
      if (untilMatch) {
        operator = untilMatch[1];
        untilValue = parseInt(untilMatch[2], 10);
        break;
      }
    }

    if (from === null || untilValue === null || !operator) {
      return 100; // fallback heuristic
    }

    if (by === 0) return 100;

    let iterations = 100;

    switch (operator) {
      case ">":
        iterations = Math.ceil((untilValue - from + 1) / by);
        break;
      case ">=":
        iterations = Math.ceil((untilValue - from) / by);
        break;
      case "<":
        iterations = Math.ceil((from - untilValue + 1) / by);
        break;
      case "<=":
        iterations = Math.ceil((from - untilValue) / by);
        break;
      case "=":
        iterations = Math.ceil(Math.abs(untilValue - from) / Math.abs(by)) + 1;
        break;
    }

    if (!Number.isFinite(iterations) || iterations < 0) return 100;
    return iterations;
  }

  _estimateUntilIterations(start) {
    for (let i = start; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;

      const line = this.upper[i].trim();
      if (!line) continue;

      if (/\bUNTIL\b/.test(line)) {
        // Dynamic UNTIL loops usually depend on file EOF / flags / variable changes.
        // Static exact count often impossible, so use heuristic.
        return 100;
      }

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
      if (
        /\b(INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|JOIN)\b/.test(
          sqlText,
        )
      )
        stats.joins++;
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
        if (afterExec && afterExec.trim()) {
          block.push(afterExec.trim());
        }
        continue;
      }

      if (inExecSql) {
        if (/\bEND-EXEC\b/.test(line)) {
          const beforeEnd = line.split(/END-EXEC/i)[0];
          if (beforeEnd && beforeEnd.trim()) {
            block.push(beforeEnd.trim());
          }

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
      tokens.forEach((t) => {
        if (!this._isKeyword(t)) used.add(t);
      });
    }
    return used;
  }

  _calculateIterations(start) {
    let from = 1,
      by = 1,
      untilValue = null,
      op = ">";

    for (let i = start; i < this.upper.length; i++) {
      const line = this.upper[i].trim();

      if (/^END-PERFORM\b/.test(line)) break;

      let f = line.match(/FROM\s+(\d+)/);
      if (f) from = parseInt(f[1]);

      let b = line.match(/BY\s+(\d+)/);
      if (b) by = parseInt(b[1]);

      let u = line.match(/UNTIL\s+\w+\s*(>|<|>=|<=)\s*(\d+)/);
      if (u) {
        op = u[1];
        untilValue = parseInt(u[2]);
      }
    }

    if (untilValue === null) return 0;

    let result = 0;

    switch (op) {
      case ">":
        result = Math.floor((untilValue - from) / by);
        break;
      case "<":
        result = Math.floor((from - untilValue) / by);
        break;
      case ">=":
        result = Math.floor((untilValue - from + 1) / by);
        break;
      case "<=":
        result = Math.floor((from - untilValue + 1) / by);
        break;
    }

    return Math.max(0, result);
  }
  _nestedLoopDepth(proc) {
    let max = 0,
      depth = 0;
    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const t = this.upper[i].trim();
      if (/\bPERFORM\b/.test(t) && !/\bPERFORM\s+[A-Z]/.test(t)) depth++;
      if (/\bEND-PERFORM\b/.test(t)) {
        max = Math.max(max, depth);
        depth = Math.max(0, depth - 1);
      }
    }
    return max;
  }

  _estIterations(proc) {
    let total = 0;
    for (let i = proc; i < this.upper.length; i++) {
      if (this._isComment(i)) continue;
      const m = this.upper[i].match(/\bPERFORM\b.*?\b(\d+)\s+TIMES\b/);
      if (m) {
        total += parseInt(m[1]);
        continue;
      }
      if (/\bPERFORM\b.*\b(UNTIL|VARYING)\b/.test(this.upper[i])) total += 100;
    }
    return total;
  }

  _countDivisions() {
    return this.upper.filter((l) => /\bDIVISION\b/.test(l)).length;
  }

  _getProgramId() {
    for (const l of this.upper) {
      const m = l.match(/\bPROGRAM-ID\s*\.\s*([A-Z0-9-]+)/);
      if (m) return m[1];
    }
    return "UNKNOWN";
  }

  _isKeyword(w) {
    return new Set([
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
    ]).has(w);
  }
}

module.exports = { CobolAnalyzer };

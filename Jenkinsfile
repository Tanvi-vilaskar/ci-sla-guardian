import groovy.json.JsonOutput

// ── sandbox-safe helpers ───────────────────────────────────────────────────

@NonCPS
private Map extractResult(def json) {
    def results    = (json.results instanceof List) ? json.results : []
    def r          = results ? results[0] : json
    def cpuVal     = (r.mlResult?.cpu_time     != null) ? r.mlResult.cpu_time     :
                     (r.cpu_time     != null)            ? r.cpu_time              : '-'
    def sessionVal = (r.mlResult?.session_time != null) ? r.mlResult.session_time :
                     (r.session_time != null)            ? r.session_time          : '-'

    // FIX: plain for-loop, no closure (closures inside @NonCPS are still sandbox-
    // intercepted). Use Groovy's .toDouble() — whitelisted — instead of
    // Double.parseDouble() which is blocked as a static method.
    def hottestList = r.hottestStatements ?: []
    def hottest     = null
    if (hottestList) {
        double bestVal = -1.0d
        for (def h : hottestList) {
            double v = -1.0d
            try { v = "${h.combined ?: 0}".toDouble() } catch (Exception ignored) {}
            if (v > bestVal) { bestVal = v; hottest = h }
        }
    }

    return [
        cpu                : "${cpuVal}s",
        session            : "${sessionVal}s",
        breached           : (r.breached ? true : false),
        combined_confidence: r.combined_confidence,
        engines_used       : r.engines_used,
        aiSummary          : r.aiSummary,
        groq_summary       : r.groq_summary,
        aiSuggestions      : r.aiSuggestions ?: [],
        hottest            : hottest,
        mlError            : r.mlResult?.error
    ]
}

@NonCPS
private String buildTableRow(String filePath, String cpu, String session,
                              String status, String decision, String rowColor) {
    return """
      <tr>
        <td>${filePath}</td><td>${cpu}</td><td>${session}</td>
        <td><strong style="color:${rowColor};">${status}</strong></td><td>${decision}</td>
      </tr>"""
}

@NonCPS
private String buildDetailHtml(String filePath, Map r, String branchRc,
                                boolean includeHottest, boolean includeSuggestions) {
    def status   = r.breached ? "BREACHED" : "OK"
    def decision = r.breached ? "Review required" : "Good to merge"
    def parts    = []

    parts << """
    <h3 style="margin-top:18px; margin-bottom:8px;">${filePath}</h3>
    <ul style="margin-top:0;">
      <li><strong>CPU Time:</strong> ${r.cpu}</li>
      <li><strong>Session Time:</strong> ${r.session}</li>
      <li><strong>Status:</strong> ${status}</li>
      <li><strong>Decision:</strong> ${decision}</li>"""

    if (r.combined_confidence) {
        parts << "      <li><strong>Combined Confidence:</strong> ${r.combined_confidence}</li>"
    }
    if (r.engines_used) {
        def eng = (r.engines_used instanceof List) ? r.engines_used.join(", ") : r.engines_used.toString()
        parts << "      <li><strong>Engines Used:</strong> ${eng}</li>"
    }
    if (includeHottest && r.breached && r.hottest) {
        parts << "      <li><strong>Hottest Statement:</strong> line ${r.hottest.line}, type ${r.hottest.type}, combined CPU ${r.hottest.combined}s</li>"
    }
    if (r.breached && branchRc) {
        parts << "      <li><strong>Branch Exit Code:</strong> ${branchRc}</li>"
    }
    parts << "    </ul>"

    if (r.aiSummary) {
        parts << """
    <h3 style="margin-top:18px; margin-bottom:8px;">BMC AI Summary</h3>
    <p>${r.aiSummary}</p>"""
    }
    if (r.groq_summary) {
        parts << """
    <h3 style="margin-top:18px; margin-bottom:8px;">Groq AI Summary</h3>
    <p>${r.groq_summary}</p>"""
    }
    if (includeSuggestions && r.breached && r.aiSuggestions) {
        parts << """
    <h3 style="margin-top:18px; margin-bottom:8px;">Optimization Suggestions</h3>"""
        r.aiSuggestions.each { block ->
            parts << """
    <h4 style="margin-bottom:6px;">Line ${block.line} (${block.type})</h4>"""
            def bmcS  = block.bmc_suggestions  ?: []
            def groqS = block.groq_suggestions ?: []
            def fallS = block.suggestions       ?: []
            if (bmcS) {
                parts << "<p><strong>BMC Suggestions</strong></p><ul>"
                bmcS.each { s -> parts << "<li><strong>WHY HOT:</strong> ${s.why_hot ?: s.suggestion}<br/><strong>FIX:</strong> ${s.fix ?: s.reason}<br/><strong>SAFETY:</strong> ${s.safety ?: 'N/A'}</li>" }
                parts << "</ul>"
            }
            if (groqS) {
                parts << "<p><strong>Groq Suggestions</strong></p><ul>"
                groqS.each { s -> parts << "<li><strong>WHY HOT:</strong> ${s.why_hot ?: s.suggestion}<br/><strong>FIX:</strong> ${s.fix ?: s.reason}<br/><strong>SAFETY:</strong> ${s.safety ?: 'N/A'}</li>" }
                parts << "</ul>"
            }
            if (!bmcS && !groqS && fallS) {
                parts << "<p><strong>Suggestions</strong></p><ul>"
                fallS.each { s -> parts << "<li><strong>WHY HOT:</strong> ${s.why_hot ?: s.suggestion}<br/><strong>FIX:</strong> ${s.fix ?: s.reason}<br/><strong>SAFETY:</strong> ${s.safety ?: 'N/A'}</li>" }
                parts << "</ul>"
            }
        }
    }
    return parts.join('\n')
}

@NonCPS
private String emailHeader(String statusColor, String statusWord, String leadLine,
                            String jobName, String buildNumber, String prInfo, String buildUrl) {
    return """<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; font-size: 13px; color: #222;">
    <p>Dear Team,</p>
    <p>This is to inform you that the <strong>Static SLA Guardian</strong> Jenkins build ${leadLine}</p>
    <h3 style="margin-bottom:4px;">Build Details</h3>
    <table cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
      <tr><td><strong>Job Name</strong></td><td>: ${jobName}</td></tr>
      <tr><td><strong>Build Number</strong></td><td>: ${buildNumber}</td></tr>
      <tr><td><strong>PR Number</strong></td><td>: ${prInfo}</td></tr>
      <tr><td><strong>Build URL</strong></td><td>: <a href="${buildUrl}">${buildUrl}</a></td></tr>
      <tr><td><strong>Result</strong></td><td>: <strong style="color:${statusColor};">${statusWord}</strong></td></tr>
    </table>
    <h3 style="margin-top:18px; margin-bottom:8px;">Result Summary</h3>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse; border:1px solid #999;">
      <tr style="background-color:#f2f2f2;">
        <th>File</th><th>CPU</th><th>Session</th><th>Status</th><th>Decision</th>
      </tr>"""
}

@NonCPS
private String emailFooter(String footerMessage) {
    return """
    <h3 style="margin-top:18px;">Required Action</h3>
    <p>${footerMessage}</p>
    <p>Regards,<br/>Jenkins CI/CD<br/>Static SLA Guardian</p>
  </body>
</html>"""
}

@NonCPS
private Map loadFileResult(String outFile, String rawContent) {
    if (!rawContent) return null
    def rawLines = rawContent.readLines()
    def start = rawLines.findIndexOf { it.trim().startsWith('{') || it.trim().startsWith('[') }
    if (start < 0) return null
    return [jsonText: rawLines.drop(start).join('\n').trim()]
}

// ── pipeline ───────────────────────────────────────────────────────────────

pipeline {
    agent any

    options { skipDefaultCheckout(true) }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Install dependencies') {
            steps {
                bat '''
                @echo off
                if exist package-lock.json (
                    call npm ci --no-audit --no-fund
                ) else (
                    echo package-lock.json not found, skipping npm ci
                )
                if exist requirement.txt (
                    python -m pip install -r requirement.txt
                ) else (
                    echo requirement.txt not found, skipping Python dependency install
                )
                '''
            }
        }

        stage('Detect changed COBOL files') {
            steps {
                script {
                    def diffRaw = ''
                    def originCheck = bat(
                        script: """
                        @echo off
                        \"${env.GIT_EXE}\" rev-parse --verify origin/main >nul 2>&1
                        if %ERRORLEVEL% == 0 (echo yes) else (echo no)
                        exit /b 0
                        """,
                        returnStdout: true
                    ).trim().readLines().last().trim()

                    if (originCheck == 'yes') {
                        try {
                            diffRaw = bat(
                                script: """
                                @echo off
                                \"${env.GIT_EXE}\" diff --name-only origin/main...HEAD 2>nul
                                exit /b 0
                                """,
                                returnStdout: true
                            ).trim()
                        } catch (Exception e) {
                            echo "origin/main...HEAD diff failed: ${e.getMessage()}"
                            diffRaw = ''
                        }
                    } else {
                        echo "origin/main not available. Falling back to HEAD~1 diff."
                    }

                    if (!diffRaw) {
                        try {
                            diffRaw = bat(
                                script: """
                                @echo off
                                \"${env.GIT_EXE}\" diff --name-only HEAD~1 2>nul
                                exit /b 0
                                """,
                                returnStdout: true
                            ).trim()
                        } catch (Exception e2) {
                            echo "HEAD~1 diff also failed: ${e2.getMessage()}"
                            diffRaw = ''
                        }
                    }

                    def diff  = diffRaw ? diffRaw.readLines() : []
                    def cobol = diff.findAll { f ->
                        def file = f.trim().toLowerCase()
                        if (!file.endsWith('.cbl') && !file.endsWith('.cob')) return false
                        def fp = f.trim()
                        def exists = bat(
                            script: """
                            @echo off
                            if exist \"${fp}\" (echo yes) else (echo no)
                            exit /b 0
                            """,
                            returnStdout: true
                        ).trim().readLines().last().trim()
                        if (exists != 'yes') { echo "Skipping deleted/missing COBOL file: ${fp}"; return false }
                        return true
                    }.collect { it.trim() }

                    env.COBOL_FILES_LIST = cobol.join('|')
                    env.COBOL_FILE_COUNT = cobol.size().toString()

                    if (!env.CHANGE_ID) {
                        echo "WARNING: Direct push — no email or PR comment will be posted."
                    }

                    if (cobol.isEmpty()) {
                        env.SLA_SUMMARY = "## COBOL SLA Analysis\n\nNo COBOL changes detected.\n\n- Build: `${env.JOB_NAME} #${env.BUILD_NUMBER}`\n- PR: `${env.CHANGE_ID ?: 'N/A'}`\n- Result: `SUCCESS`\n"
                        echo "No COBOL changes detected. Skipping SLA analysis."
                    } else {
                        echo "COBOL files to analyse (${cobol.size()}): ${cobol.join(', ')}"
                    }
                }
            }
        }

        stage('Run SLA analysis - parallel') {
            when { expression { env.COBOL_FILE_COUNT?.toInteger() > 0 } }
            steps {
                script {
                    def cobolFiles       = env.COBOL_FILES_LIST.tokenize('|')
                    def parallelBranches = [:]

                    cobolFiles.each { filePath ->
                        def thisFile   = filePath
                        def safeKey    = thisFile.replaceAll('[^A-Za-z0-9_.-]', '_')
                        def outFile    = "ci-result-${safeKey}.json"
                        def statusFile = "ci-status-${safeKey}.txt"

                        parallelBranches["SLA: ${thisFile}"] = {
                            echo "Analysing: ${thisFile}"
                            bat """
                            @echo off
                            if exist "${outFile}" del /f /q "${outFile}"
                            if exist "${statusFile}" del /f /q "${statusFile}"
                            node ci/runAnalysis.js "${thisFile}" > "${outFile}"
                            echo %ERRORLEVEL% > "${statusFile}"
                            if exist "${outFile}" (echo [OK] ${outFile} generated) else (echo [WARN] ${outFile} was NOT generated)
                            exit /b 0
                            """
                        }
                    }
                    parallel parallelBranches
                }
            }
        }

        stage('Summarize results') {
            when { expression { env.COBOL_FILE_COUNT?.toInteger() > 0 } }
            steps {
                script {
                    def cobolFiles    = env.COBOL_FILES_LIST.tokenize('|')
                    def resultLines   = []
                    def detailBlocks  = []
                    def okCount       = 0
                    def breachedCount = 0

                    cobolFiles.each { filePath ->
                        def safeKey    = filePath.replaceAll('[^A-Za-z0-9_.-]', '_')
                        def outFile    = "ci-result-${safeKey}.json"
                        def statusFile = "ci-status-${safeKey}.txt"
                        def branchRc   = fileExists(statusFile) ? readFile(statusFile).trim() : "999"
                        def branchFailed = branchRc != "0"
                        def detail = ["<details>"]

                        if (!fileExists(outFile)) {
                            breachedCount++
                            resultLines << "| `${filePath}` | `-` | `-` | BREACHED | Review required |"
                            detail << "<summary><strong>${filePath}</strong> - BREACHED</summary>\n\n- Note: Analysis output file was not generated.\n- Branch Exit Code: `${branchRc}`\n\n</details>"
                            detailBlocks << detail.join('\n'); return
                        }

                        def raw = readFile(outFile).trim()
                        if (!raw) {
                            breachedCount++
                            resultLines << "| `${filePath}` | `-` | `-` | BREACHED | Review required |"
                            detail << "<summary><strong>${filePath}</strong> - BREACHED</summary>\n\n- Note: Output file is empty.\n- Branch Exit Code: `${branchRc}`\n\n</details>"
                            detailBlocks << detail.join('\n'); return
                        }

                        def parsed = loadFileResult(outFile, raw)
                        if (!parsed) {
                            breachedCount++
                            resultLines << "| `${filePath}` | `-` | `-` | BREACHED | Review required |"
                            detail << "<summary><strong>${filePath}</strong> - BREACHED</summary>\n\n- Note: No valid JSON in output.\n- Branch Exit Code: `${branchRc}`\n\n</details>"
                            detailBlocks << detail.join('\n'); return
                        }

                        writeFile file: outFile, text: parsed.jsonText
                        def json
                        try {
                            json = readJSON file: outFile
                        } catch (Exception e) {
                            breachedCount++
                            resultLines << "| `${filePath}` | `-` | `-` | BREACHED | Review required |"
                            detail << "<summary><strong>${filePath}</strong> - BREACHED</summary>\n\n- Note: JSON parsing failed: ${e.getMessage()}\n- Branch Exit Code: `${branchRc}`\n\n</details>"
                            detailBlocks << detail.join('\n'); return
                        }

                        def r        = extractResult(json)
                        def breached = branchFailed || r.breached
                        def status   = breached ? "BREACHED" : "OK"
                        def decision = breached ? "Review required" : "Good to merge"

                        if (breached) { breachedCount++ } else { okCount++ }

                        resultLines << "| `${filePath}` | `${r.cpu}` | `${r.session}` | ${status} | ${decision} |"
                        detail << "<summary><strong>${filePath}</strong> - ${status}</summary>"
                        detail << ""
                        detail << "- CPU Time: `${r.cpu}`"
                        detail << "- Session Time: `${r.session}`"
                        detail << "- Status: ${status}"
                        detail << "- Decision: ${decision}"
                        if (r.combined_confidence) { detail << "- Combined Confidence: `${r.combined_confidence}`" }
                        if (r.engines_used) {
                            def eng = (r.engines_used instanceof List) ? r.engines_used.join(", ") : r.engines_used.toString()
                            detail << "- Engines Used: ${eng}"
                        }

                        if (breached) {
                            detail << "- SLA Threshold: `${env.SLA_THRESHOLD}s`"
                            detail << "- Branch Exit Code: `${branchRc}`"
                            if (r.hottest)      { detail << "- Hottest Statement: line `${r.hottest.line}`, type `${r.hottest.type}`, combined CPU `${r.hottest.combined}s`" }
                            if (r.aiSummary)    { detail << "- AI Summary (BMC AMI): ${r.aiSummary}" }
                            if (r.groq_summary) { detail << "- AI Summary (Groq): ${r.groq_summary}" }

                            if (r.aiSuggestions && r.aiSuggestions.size() > 0) {
                                detail << ""; detail << "### Optimization Suggestions"; detail << ""
                                r.aiSuggestions.each { block ->
                                    detail << "#### Line `${block.line}` (`${block.type}`)"
                                    detail << ""
                                    def bmcS  = block.bmc_suggestions  ?: []
                                    def groqS = block.groq_suggestions ?: []
                                    def fallS = block.suggestions       ?: []
                                    if (bmcS) {
                                        detail << "**BMC AMI**"; detail << ""
                                        bmcS.eachWithIndex { s, i -> detail << "${i+1}. WHY HOT: ${s.why_hot ?: s.suggestion}"; detail << "   - FIX: ${s.fix ?: s.reason}"; detail << "   - SAFETY: ${s.safety}" }
                                        detail << ""
                                    }
                                    if (groqS) {
                                        detail << "**Groq**"; detail << ""
                                        groqS.eachWithIndex { s, i -> detail << "${i+1}. WHY HOT: ${s.why_hot ?: s.suggestion}"; detail << "   - FIX: ${s.fix ?: s.reason}"; detail << "   - SAFETY: ${s.safety}" }
                                        detail << ""
                                    }
                                    if (!bmcS && !groqS && fallS) {
                                        detail << "**Fallback**"; detail << ""
                                        fallS.eachWithIndex { s, i -> detail << "${i+1}. WHY HOT: ${s.why_hot ?: s.suggestion}"; detail << "   - FIX: ${s.fix ?: s.reason}"; detail << "   - SAFETY: ${s.safety}" }
                                        detail << ""
                                    }
                                }
                            }
                            if (r.mlError) { detail << ""; detail << "- ML Error: ${r.mlError}" }
                        }

                        detail << ""; detail << "</details>"
                        detailBlocks << detail.join('\n')
                    }

                    def totalCount = cobolFiles.size()
                    def overallStatus
                    if (okCount == totalCount) {
                        currentBuild.result = 'SUCCESS';  overallStatus = "OK"
                    } else if (okCount > 0) {
                        currentBuild.result = 'UNSTABLE'; overallStatus = "PARTIAL REVIEW REQUIRED"
                    } else {
                        currentBuild.result = 'FAILURE';  overallStatus = "BLOCK MERGE"
                    }

                    def summaryMd = []
                    summaryMd << "## COBOL SLA Analysis\n"
                    summaryMd << "**Build:** `${env.JOB_NAME} #${env.BUILD_NUMBER}`  "
                    summaryMd << "**PR:** `${env.CHANGE_ID ?: 'N/A'}`  "
                    summaryMd << "**Files Analysed:** `${totalCount}`  "
                    summaryMd << "**Overall Status:** `${overallStatus}`  "
                    summaryMd << "**OK Files:** `${okCount}`  "
                    summaryMd << "**Breached Files:** `${breachedCount}`\n"
                    summaryMd << "### Result Summary\n"
                    summaryMd << "| File | CPU | Session | Status | Decision |"
                    summaryMd << "|---|---:|---:|---|---|"
                    summaryMd.addAll(resultLines)
                    if (detailBlocks) { summaryMd << "\n### Detailed Analysis\n"; summaryMd.addAll(detailBlocks) }

                    def summaryMsg = summaryMd.join('\n')
                    writeFile file: 'sla-comment.md', text: summaryMsg
                    echo summaryMsg
                    env.SLA_SUMMARY = summaryMsg
                }
            }
        }
    }

    post {
        success  { script { _sendEmail('success')  } }
        unstable { script { _sendEmail('unstable') } }
        failure  { script { _sendEmail('failure')  } }

        always {
            script {
                if (!env.CHANGE_ID) { echo "No CHANGE_ID. Skipping PR comment."; return }

                if (!env.SLA_SUMMARY?.trim()) {
                    env.SLA_SUMMARY = "## COBOL SLA Analysis\n\nNo SLA summary was generated.\n\n- Job: `${env.JOB_NAME}`\n- Build Number: `${env.BUILD_NUMBER}`\n- Result: `${currentBuild.currentResult}`\n"
                }

                def commentBody
                if (currentBuild.currentResult == 'SUCCESS') {
                    def filteredLines   = []
                    def skipSuggestions = false
                    env.SLA_SUMMARY.readLines().each { line ->
                        if (line.trim().startsWith('### Optimization Suggestions')) { skipSuggestions = true }
                        if (line.trim().startsWith('</details>'))                   { skipSuggestions = false }
                        if (line.trim().startsWith('- Hottest Statement:'))         { return }
                        if (!skipSuggestions) { filteredLines << line }
                    }
                    commentBody = filteredLines.join('\n')
                } else {
                    commentBody = env.SLA_SUMMARY
                }

                commentBody += """

---

<details>
<summary><strong>Jenkins metadata</strong></summary>

- Job: `${env.JOB_NAME}`
- Build Number: `${env.BUILD_NUMBER}`
- Build URL: ${env.BUILD_URL ?: 'N/A'}
- Result: `${currentBuild.currentResult}`

</details>
"""
                def payload = JsonOutput.toJson([body: commentBody])
                writeFile file: 'comment-payload.json', text: payload

                def prNumber = env.CHANGE_ID
                def repo = "Tanvi-vilaskar/ci-sla-guardian"

                def apiUrl   = "https://api.github.com/repos/${repo}/issues/${prNumber}/comments"

                try {
                    withCredentials([string(credentialsId: 'github-token', variable: 'GHTOKEN')]) {
                        bat """
                        @echo off
                        curl -s -H "Authorization: token %GHTOKEN%" ^
                             -H "Content-Type: application/json" ^
                             --data @comment-payload.json ^
                             "${apiUrl}"
                        """
                    }
                    echo "PR comment posted successfully."
                } catch (e) {
                    echo "Skipping PR comment: ${e.getMessage()}"
                }
            }
        }
    }
}

// ── Shared email sender — outside pipeline{} to stay under CPS bytecode limit

def _sendEmail(String outcome) {
    if (!env.CHANGE_ID) { echo "Direct push. Skipping ${outcome} email."; return }
    try {
        def prInfo     = env.CHANGE_ID ?: 'N/A'
        def buildUrl   = env.BUILD_URL  ?: 'N/A'
        def cobolFiles = env.COBOL_FILES_LIST ? env.COBOL_FILES_LIST.tokenize('|') : []

        def statusColor; def statusWord; def leadLine; def footerMsg
        def inclHottest; def inclSuggestions; def subjectTag; def summaryLine
        def defaultStatus; def defaultDecision

        switch (outcome) {
            case 'success':
                statusColor     = '#1a7f37'; statusWord = 'SUCCESS'
                leadLine        = "has <strong style='color:#1a7f37;'>passed</strong> successfully."
                footerMsg       = "No action required — this build passed."
                subjectTag      = '[SUCCESS] Static SLA Guardian Build Passed'
                summaryLine     = "<p>All analysed COBOL files are within SLA thresholds. This PR is <strong style='color:#1a7f37;'>good to merge</strong>.</p>"
                inclHottest     = false; inclSuggestions = false
                defaultStatus   = "OK"; defaultDecision = "Good to merge"
                break
            case 'unstable':
                statusColor     = '#b8860b'; statusWord = 'UNSTABLE'
                leadLine        = "is <strong style='color:#b8860b;'>UNSTABLE</strong> — some files passed, some require review."
                footerMsg       = "Some files breached SLA. Please review AI suggestions for breached files, apply optimizations, and re-run before merging."
                subjectTag      = '[UNSTABLE] Static SLA Guardian Partial Review Required'
                summaryLine     = ""
                inclHottest     = true; inclSuggestions = true
                defaultStatus   = "BREACHED"; defaultDecision = "Review required"
                break
            default: // failure
                statusColor     = '#b00020'; statusWord = 'FAILED'
                leadLine        = "has <strong style='color:#b00020;'>failed</strong>."
                footerMsg       = "Please review the failed build logs and SLA analysis, apply AI optimization suggestions where appropriate, and re-run before merging."
                subjectTag      = '[ACTION REQUIRED] Static SLA Guardian Build Failed'
                summaryLine     = ""
                inclHottest     = true; inclSuggestions = true
                defaultStatus   = "BREACHED"; defaultDecision = "Review required"
        }

        def parts = []
        parts << emailHeader(statusColor, statusWord, leadLine,
                             env.JOB_NAME, env.BUILD_NUMBER, prInfo, buildUrl)

        // Table rows
        cobolFiles.each { filePath ->
            def safeKey  = filePath.replaceAll('[^A-Za-z0-9_.-]', '_')
            def outFile  = "ci-result-${safeKey}.json"
            def cpu      = "-"; def session = "-"
            def status   = defaultStatus
            def decision = defaultDecision
            def rowColor = (outcome == 'success') ? '#1a7f37' : '#b00020'

            if (fileExists(outFile)) {
                def raw    = readFile(outFile).trim()
                def parsed = loadFileResult(outFile, raw)
                if (parsed) {
                    writeFile file: outFile, text: parsed.jsonText
                    def r    = extractResult(readJSON(file: outFile))
                    cpu      = r.cpu; session = r.session
                    status   = r.breached ? "BREACHED" : "OK"
                    decision = r.breached ? "Review required" : "Good to merge"
                    // for unstable: colour per file result
                    if (outcome == 'unstable') {
                        rowColor = r.breached ? '#b00020' : '#1a7f37'
                    }
                }
            }
            parts << buildTableRow(filePath, cpu, session, status, decision, rowColor)
        }
        parts << "\n    </table>"

        // Detail blocks
        cobolFiles.each { filePath ->
            def safeKey = filePath.replaceAll('[^A-Za-z0-9_.-]', '_')
            def outFile = "ci-result-${safeKey}.json"
            if (!fileExists(outFile)) { return }
            def raw    = readFile(outFile).trim()
            def parsed = loadFileResult(outFile, raw)
            if (!parsed) { return }
            writeFile file: outFile, text: parsed.jsonText
            def r = extractResult(readJSON(file: outFile))
            parts << buildDetailHtml(filePath, r, "0", inclHottest, inclSuggestions)
        }

        if (summaryLine) {
            parts << """
    <h3 style="margin-top:18px;">Summary</h3>
    ${summaryLine}"""
        }
        parts << emailFooter(footerMsg)

        emailext(
            to:       "tanvilaskar01@gmail.com",
            subject:  "${subjectTag} | ${env.JOB_NAME} #${env.BUILD_NUMBER} | PR ${prInfo}",
            body:     parts.join('\n'),
            mimeType: 'text/html'
        )
        echo "${outcome.capitalize()} email sent."
    } catch (e) {
        echo "Failed to send ${outcome} email: ${e.getMessage()}"
    }
}
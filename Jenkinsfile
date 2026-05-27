pipeline {
    agent any

    environment {
        SLA_THRESHOLD      = "5.0"
        SESSION_THRESHOLD  = "20.0"
        LINE_CPU_THRESHOLD = "15"
        SLA_AI_ENABLED     = "true"
        GROQ_API_KEY       = credentials('groq-api-key')
        GROQ_MODEL         = "llama-3.3-70b-versatile"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Node dependencies') {
            steps {
                bat 'npm ci'
            }
        }

        stage('Install Python dependencies') {
            steps {
                bat 'python -m pip install -r requirement.txt'
            }
        }

        stage('Detect changed COBOL files') {
            steps {
                script {
                    def diffRaw = bat(
                        script: 'git diff --name-only origin/main...HEAD 2>nul || git diff --name-only HEAD~1',
                        returnStdout: true
                    ).trim()

                    echo "Raw diff output:\n${diffRaw}"

                    def diff = diffRaw ? diffRaw.readLines() : []

                    def cobol = diff.findAll { f ->
                        def file = f.trim().toLowerCase()
                        file.endsWith('.cbl') || file.endsWith('.cob')
                    }

                    env.COBOL_FILES = cobol.join(' ')

                    if (!env.COBOL_FILES?.trim()) {
                        echo "No COBOL changes detected; skipping SLA analysis."
                    } else {
                        echo "COBOL files to analyze: ${env.COBOL_FILES}"
                    }
                }
            }
        }

        stage('Run SLA analysis') {
            when {
                expression { env.COBOL_FILES?.trim() }
            }
            steps {
                bat """
                node ci/runAnalysis.js ${env.COBOL_FILES} > ci-result.json
                echo NODE_EXIT=%ERRORLEVEL%
                if exist ci-result.json (
                    echo ci-result.json generated successfully
                ) else (
                    echo ci-result.json was not generated
                    exit /b 1
                )
                exit /b 0
                """
            }
        }

        stage('Summarize result') {
            when {
                expression { env.COBOL_FILES?.trim() }
            }
            steps {
                script {
                    def raw = readFile('ci-result.json')
                    echo "Raw ci-result.json:\n${raw}"

                    def lines = raw.readLines()
                    def startIndex = lines.findIndexOf { it.trim().startsWith('{') }

                    if (startIndex < 0) {
                        error("SLA summary failed: no JSON object found in ci-result.json")
                    }

                    def jsonText = lines.drop(startIndex).join('\n').trim()
                    writeFile file: 'ci-result.json', text: jsonText

                    def json = readJSON file: 'ci-result.json'
                    echo "Debug: top-level keys = ${json.keySet()}"

                    def results = (json.results instanceof List) ? json.results : []
                    def breachedFlags = results.collect { r -> r?.breached ? true : false }
                    def breached = breachedFlags.contains(true)

                    echo "Debug: breached flags = ${breachedFlags}"

                    def linesOut = []
                    linesOut << "SLA analysis for PR:"
                    linesOut << ""

                    results.each { r ->
                        def cpu = r.mlResult?.cpu_time ?: 0
                        def session = r.mlResult?.session_time ?: 0
                        def status = r.breached ? "BREACHED" : "OK"

                        def hottestList = r.hottestStatements ?: []
                        def hottest = hottestList ? hottestList.max { (it.combined ?: 0) as BigDecimal } : null

                        linesOut << "- `${r.file}` -> CPU=${cpu}s, Session=${session}s, Status=${status}"

                        if (hottest) {
                            linesOut << "  - Hottest stmt: line ${hottest.line}, type ${hottest.type}, combined CPU=${hottest.combined}"
                        }

                        if (r.aiSummary) {
                            linesOut << "  - AI Summary: ${r.aiSummary}"
                        }

                        def aiSuggestions = r.aiSuggestions ?: []
                        if (aiSuggestions && aiSuggestions.size() > 0) {
                            def topSuggestionBlock = aiSuggestions[0]
                            def topSuggestion = topSuggestionBlock?.suggestions ? topSuggestionBlock.suggestions[0] : null
                            if (topSuggestion) {
                                linesOut << "  - Suggestion: ${topSuggestion.suggestion}"
                                linesOut << "  - Reason: ${topSuggestion.reason}"
                                linesOut << "  - Safety: ${topSuggestion.safety}"
                            }
                        }

                        if (r.mlResult?.error) {
                            linesOut << "  - ML Error: ${r.mlResult.error}"
                        }

                        linesOut << ""
                    }

                    def summaryMsg = linesOut.join("\n")
                    echo summaryMsg
                    env.SLA_SUMMARY = summaryMsg

                    if (breached) {
                        echo "SLA BREACHED for at least one COBOL program."
                        error("SLA breached; failing build.")
                    } else {
                        echo "All analyzed COBOL programs are within SLA."
                    }
                }
            }
        }
    }

    post {
        failure {
            script {
                try {
                    emailext(
                        to: "tanvilaskar01@gmail.com",
                        subject: "BUILD FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                        body: """The Jenkins build failed.

Job: ${env.JOB_NAME}
Build Number: ${env.BUILD_NUMBER}
PR: ${env.CHANGE_ID ?: 'N/A'}
Build URL: ${env.BUILD_URL}
Result: ${currentBuild.currentResult}

SLA Summary:
${env.SLA_SUMMARY ?: 'No SLA summary available.'}
""",
                        mimeType: 'text/plain'
                    )
                    echo "Failure notification email sent."
                } catch (e) {
                    echo "Failed to send failure email: ${e.getMessage()}"
                }
            }
        }

        always {
            script {
                if (!env.CHANGE_ID || !env.SLA_SUMMARY) {
                    return
                }

                def prNumber = env.CHANGE_ID
                def repo = "Tanvi-vilaskar/ci-sla-guardian"
                def apiUrl = "https://api.github.com/repos/${repo}/issues/${prNumber}/comments"

                writeFile file: 'sla-comment.txt', text: env.SLA_SUMMARY

                try {
                    withCredentials([string(credentialsId: 'github-token', variable: 'GHTOKEN')]) {
                        bat """
                        setlocal ENABLEDELAYEDEXPANSION
                        set BODY=
                        for /f "usebackq delims=" %%A in ("sla-comment.txt") do (
                            set "BODY=!BODY!%%A\\n"
                        )
                        curl -H "Authorization: token %GHTOKEN%" ^
                             -H "Content-Type: application/json" ^
                             -d "{\\"body\\": \\"!BODY!\\n(Jenkins job: ${env.JOB_NAME} #${env.BUILD_NUMBER})\\"}" ^
                             ${apiUrl}
                        endlocal
                        """
                    }
                } catch (e) {
                    echo "Skipping PR comment (credentials missing or curl error): ${e.getMessage()}"
                }
            }
        }
    }
}
pipeline {
    agent any

    environment {
        SLA_THRESHOLD       = "5.0"
        SESSION_THRESHOLD   = "20.0"
        LINE_CPU_THRESHOLD  = "15"
        SLA_AI_ENABLED      = "false"
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
                bat 'pip install -r requirement.txt'
            }
        }

        stage('Detect changed COBOL files') {
            steps {
                script {
                    // Try diff vs origin/main; fall back to previous commit
                    def diffRaw = bat(
                        script: 'git diff --name-only origin/main...HEAD || git diff --name-only HEAD~1',
                        returnStdout: true
                    ).trim()

                    echo "Raw diff output:\n${diffRaw}"

                    def diff = diffRaw ? diffRaw.split('\n') : []

                    // Pick only COBOL files (case-insensitive)
                    def cobol = diff.findAll { f ->
                        f.toLowerCase().endsWith('.cbl') || f.toLowerCase().endsWith('.cob')
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
                // Run analysis, but do not stop the pipeline on non-zero exit code from Node
                bat """
                node ci/runAnalysis.js ${env.COBOL_FILES} > ci-result.json
                echo NODE_EXIT=%ERRORLEVEL%
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
                    // 1) Read raw contents (may include banners)
                    def raw = readFile 'ci-result.json'
                    echo "Raw ci-result.json:\n${raw}"

                    // 2) Find first '{' and keep from there onwards
                    def braceIndex = raw.indexOf('{')
                    if (braceIndex < 0) {
                        echo "ci-result.json does not contain a JSON object start: ${raw}"
                        error("SLA summary failed: no JSON object found in ci-result.json")
                    }
                    def jsonText = raw.substring(braceIndex).trim()

                    // 3) Overwrite file with clean JSON
                    writeFile file: 'ci-result.json', text: jsonText

                    // 4) Parse JSON
                    def json = readJSON file: 'ci-result.json'

                    // Normalize breached flags to booleans
                    def breachedFlags = json.results.collect { r -> r.breached ? true : false }
                    echo "Debug: breached flags = ${breachedFlags}"
                    def breached = breachedFlags.contains(true)

                    // 5) Build human-readable summary
                    def lines = []
                    lines << "SLA analysis for PR:"
                    lines << ""
                    json.results.each { r ->
                        def cpu     = r.mlResult?.cpu_time     ?: 0
                        def session = r.mlResult?.session_time ?: 0
                        def status  = (r.breached ? "BREACHED" : "OK")
                        lines << "- `${r.file}` → CPU=${cpu}s, Session=${session}s, Status=${status}"
                        if (r.mlResult?.error) {
                            lines << "  - ML Error: ${r.mlResult.error}"
                        }
                    }
                    lines << ""
                    lines << "Thresholds: SLA_THRESHOLD=${env.SLA_THRESHOLD}s, SESSION_THRESHOLD=${env.SESSION_THRESHOLD}s"

                    def summaryMsg = lines.join("\n")
                    echo summaryMsg
                    env.SLA_SUMMARY = summaryMsg

                    if (breached) {
                        echo "SLA BREACHED for at least one COBOL program. [pipeline v2]"
                        error("SLA breached; failing build.")
                    } else {
                        echo "All analyzed COBOL programs are within SLA. [pipeline v2]"
                    }
                }
            }
        }
    }
}
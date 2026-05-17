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

        stage('Detect changed COBOL files') {
            steps {
                script {
                    // Get diff vs main (or previous commit as fallback)
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
                bat "node ci/runAnalysis.js ${env.COBOL_FILES} > ci-result.json"
            }
        }

        stage('Summarize result') {
            when {
                expression { env.COBOL_FILES?.trim() }
            }
            steps {
                script {
                    // 1) Read raw contents (may include dotenvx banner)
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
                    def breached = json.results.any { it.breached }

                    if (breached) {
                        echo "SLA BREACHED for at least one COBOL program. [pipeline v2]"
                    } else {
                        echo "All analyzed COBOL programs are within SLA. [pipeline v2]"
                    }

                    json.results.each { r ->
                        def cpu = r.mlResult?.cpu_time ?: 0
                        def session = r.mlResult?.session_time ?: 0
                        echo "File ${r.file}: CPU=${cpu}s, Session=${session}s, breached=${r.breached}"
                        if (r.aiSummary) {
                            echo "AI Suggestions: ${r.aiSummary}"
                        }
                    }

                    if (breached) {
                        error("SLA breached; failing build.")
                    }
                }
            }
        }
    }
}
pipeline {
    agent any

    environment {
        SLA_THRESHOLD      = "5.0"
        SESSION_THRESHOLD  = "20.0"
        LINE_CPU_THRESHOLD = "15"
        SLA_AI_ENABLED     = "false"
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

                    def diffRaw = bat(
                        script: '''
git diff --name-only origin/main...HEAD
''',
                        returnStdout: true
                    ).trim()

                    echo "Raw diff output:\n${diffRaw}"

                    def diff = diffRaw ? diffRaw.split('\n') : []

                    def cobol = diff.findAll { f ->
                        f.toLowerCase().endsWith('.cbl') ||
                        f.toLowerCase().endsWith('.cob')
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

                    def braceIndex = raw.indexOf('{')

                    if (braceIndex < 0) {
                        error("ci-result.json does not contain valid JSON")
                    }

                    def jsonText = raw.substring(braceIndex).trim()

                    writeFile(
                        file: 'ci-result.json',
                        text: jsonText
                    )

                    def json = readJSON file: 'ci-result.json'

                    def breached = json.results.any { it.breached }

                    def lines = []

                    lines << "SLA analysis for PR:"
                    lines << ""

                    json.results.each { r ->

                        def cpu = r.mlResult?.cpu_time ?: 0
                        def session = r.mlResult?.session_time ?: 0
                        def status = r.breached ? "BREACHED" : "OK"

                        lines << "- ${r.file} -> CPU=${cpu}s, Session=${session}s, Status=${status}"

                        if (r.mlResult?.error) {
                            lines << "  ML Error: ${r.mlResult.error}"
                        }
                    }

                    lines << ""
                    lines << "Thresholds:"
                    lines << "CPU <= ${env.SLA_THRESHOLD}s"
                    lines << "Session <= ${env.SESSION_THRESHOLD}s"

                    def summaryMsg = lines.join("\n")

                    echo summaryMsg

                    env.SLA_SUMMARY = summaryMsg

                    if (breached) {

                        echo "SLA BREACHED for at least one COBOL program."

                        currentBuild.result = 'FAILURE'

                        error("SLA breached; failing build.")

                    } else {

                        echo "All analyzed COBOL programs are within SLA."
                    }
                }
            }
        }
    }

    post {

        always {

            archiveArtifacts artifacts: 'ci-result.json', allowEmptyArchive: true

            echo "Pipeline execution completed."
        }

        failure {

            echo "Build failed due to SLA breach or analysis error."
        }

        success {

            echo "Build passed successfully."
        }
    }
}
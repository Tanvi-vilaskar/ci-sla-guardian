# COBOL SLA Guardian — CI/CD Performance Impact Agent

> A static performance analysis agent that integrates directly into the CI/CD pipeline. It analyzes COBOL code changes **without running them on a test LPAR**, predicts their resource consumption using trained ML models, and fails the build if the predicted impact would breach production SLAs.

---

## What it does

When a developer raises a Pull Request with COBOL changes, the pipeline automatically:

1. Detects which `.cbl` / `.cob` files changed
2. Parses and validates the COBOL syntax statically
3. Extracts performance features (loop depth, I/O operations, arithmetic, control flow)
4. Feeds those features into a trained Random Forest ML model to predict `cpu_time` and `session_time`
5. Identifies the hottest (most CPU-intensive) statements line by line
6. Calls a GROQ LLM (Llama 3.3 70B) for AI-generated optimization suggestions
7. Fails the Jenkins build if the predicted CPU time exceeds the SLA threshold
8. Posts the full analysis summary as a comment on the GitHub Pull Request

---

## Architecture

```
Developer PR (COBOL change)
        │
        ▼
  Jenkins Pipeline
        │
        ├── git diff → detect .cbl/.cob changes
        │
        ├── node ci/runAnalysis.js
        │       │
        │       ├── CobolAnalyzer       → syntax validation + feature extraction
        │       ├── ML Model (Python)   → predict cpu_time, session_time
        │       ├── FeatureExtractor    → line-by-line statement rows
        │       └── GROQ LLM            → AI optimization suggestions
        │
        ├── ci-result.json
        │
        ├── SLA check → PASS or FAIL build
        │
        └── GitHub API → PR comment with full SLA report
```

Additionally, a **VS Code Extension** gives developers the same analysis locally before pushing — with a live dashboard, inline diagnostics, and dead-code detection.

---

## Tech stack

| Layer | Technology |
|---|---|
| CI/CD | Jenkins (multibranch pipeline) |
| Code analysis | Node.js (custom COBOL parser) |
| ML model | Python · scikit-learn Random Forest |
| AI suggestions | GROQ API · Llama 3.3 70B Versatile |
| IDE integration | VS Code Extension API |
| BMC integration | BMC Helix ITSM (optional) |
| Version control | GitHub (multibranch: `main`, `feature`, `demo`, `test`) |

---

## Project structure

```
ci-sla-guardian/
├── Jenkinsfile                  # Multibranch pipeline definition
├── ci/
│   └── runAnalysis.js           # CI entry point — orchestrates full analysis
├── src/
│   ├── extension.js             # VS Code extension activation
│   ├── cobolAnalyzer.js         # COBOL static parser & feature extractor (1100+ lines)
│   ├── featureExtractor.js      # Statement-level row builder for ML input
│   ├── cpuPredictor.js          # Calls Python ML model via execFile
│   ├── aiOptimizer.js           # GROQ / BMC LLM integration
│   └── dashboardPanel.js        # VS Code webview dashboard
├── backend/
│   └── predict.py               # Python ML inference script
├── models/
│   ├── cobol_model.pkl          # Trained COBOL program-level model
│   ├── random_forest_model.pkl  # Statement-level Random Forest model
│   ├── scaler.pkl               # Feature scaler
│   ├── scaler_X.pkl             # Input scaler for statement model
│   └── label_encoder.pkl        # COBOL statement type encoder
├── sample-data/
│   ├── loop1.cbl                # Heavy nested loop (SLA breach demo)
│   ├── loop2.cbl                # Multi-level loop test
│   └── loop4–6.cbl              # Additional test programs
├── output/
│   └── sla_features/            # Feature extraction output files
├── requirement.txt              # Python dependencies
└── package.json                 # Node.js dependencies + VS Code manifest
```

---

## Setup & installation

### Prerequisites

- Jenkins with the **Multibranch Pipeline** and **GitHub Branch Source** plugins
- Node.js 18+
- Python 3.9+
- A GROQ API key (free tier at [console.groq.com](https://console.groq.com))

### Jenkins credentials required

| Credential ID | Type | Value |
|---|---|---|
| `groq-api-key` | Secret text | Your GROQ API key |
| `github-token` | Secret text | GitHub PAT with `repo` scope |

### Local development (VS Code extension)

```bash
git clone https://github.com/Tanvi-vilaskar/ci-sla-guardian.git
cd ci-sla-guardian
npm install
pip install -r requirement.txt
```

Open in VS Code → press `F5` to launch the Extension Development Host → open any `.cbl` file → save to trigger analysis.

### Running CI analysis manually

```bash
node ci/runAnalysis.js sample-data/loop2.cbl
```

---

## Pipeline configuration

The Jenkinsfile uses these environment variables — all configurable per branch or globally in Jenkins:

| Variable | Default | Description |
|---|---|---|
| `SLA_THRESHOLD` | `5.0` | Max predicted CPU time in seconds before build fails |
| `SESSION_THRESHOLD` | `20.0` | Max predicted session time in seconds |
| `LINE_CPU_THRESHOLD` | `15` | Per-statement CPU % threshold for hotspot flagging |
| `SLA_AI_ENABLED` | `true` | Toggle GROQ LLM suggestions on/off |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | GROQ model to use for optimization suggestions |

---

## SLA breach output example

When the pipeline detects a breach, it posts this to the PR:

```
SLA analysis for PR:

- `sample-data/loop2.cbl` -> CPU=12.4s, Session=45.2s, Status=BREACHED
  - Hottest stmt: line 19, type PERFORM, combined CPU=8.3
  - AI Summary: The MAIN-LOOP contains 7 levels of nested PERFORM loops
    with combined iteration count exceeding 375 billion operations.
  - Suggestion: Replace innermost loops with set-based COMPUTE operations
  - Reason: Reduces O(n^7) complexity to O(n^4)
  - Safety: Safe to apply — no file I/O or external calls in inner loop

Thresholds: SLA_THRESHOLD=5.0s, SESSION_THRESHOLD=20.0s

SLA Guardian: BUILD FAILED (Static Performance Analysis)
```

---

## VS Code extension commands

| Command | Description |
|---|---|
| `SLA Guardian: Show Dashboard` | Open the analysis dashboard for the current COBOL file |
| `SLA Guardian: Extract Features` | Export feature JSON for ML model training |
| `SLA Guardian: Clear Diagnostics` | Remove all inline warning markers |

Analysis runs automatically on every file save (configurable via `slaGuardian.enableOnSave`).

---

## Branch strategy

| Branch | Purpose |
|---|---|
| `main` | Stable — triggers full SLA pipeline on every PR |
| `feature` | Active development branch |
| `demo` | Demo-ready COBOL programs for showcasing SLA breach |
| `test` | Experimental COBOL programs for ML model stress testing |

25+ Pull Requests have been raised and merged across branches during development, with the Jenkins pipeline running on each one.

---

## ML model details

Two models are trained and used:

**Program-level model** (`cobol_model.pkl`) — predicts overall `cpu_time` and `session_time` for the full program based on aggregated features: max loop depth, nested loop count, total PERFORMs, file I/O count, IF statements, function calls, and arithmetic operations.

**Statement-level model** (`random_forest_model.pkl`) — predicts per-statement `combined`, `attributed`, and `executed` CPU % for each COBOL statement type (PERFORM, COMPUTE, MOVE, READ, WRITE, etc.), enabling line-by-line hotspot identification.

Training data source: Historical RMF/SMF performance monitoring logs correlated with COBOL program structure.

---

## Known limitations

- Analysis is static — actual runtime can vary based on data volumes and system load
- COBOL dialect support is tuned for IBM Enterprise COBOL (fixed-format); free-format COBOL has partial support
- ML models were trained on a specific workload profile — predictions are estimates, not guarantees
- GROQ API requires internet access from the Jenkins agent

---

## License

VIIT — see `LICENSE` for details.
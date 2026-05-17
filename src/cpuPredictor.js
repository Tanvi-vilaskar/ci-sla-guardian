"use strict";

const { execFile } = require("child_process");
const path = require("path");

function predict(features, mode = "program") {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, "..", "backend", "predict.py");

    // Ensure we always send a plain JSON string (no undefined)
    const inputString = JSON.stringify(features || {});

    const args = [scriptPath, inputString, mode];

    execFile("python", args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        // If predict.py printed a JSON error, try to surface that first
        const rawErr = (stderr || "").trim() || (stdout || "").trim();

        try {
          const parsed = rawErr ? JSON.parse(rawErr) : null;
          if (parsed && typeof parsed.success === "boolean") {
            return resolve(parsed);
          }
        } catch (e) {
          // Not JSON; fall through to generic error
        }

        return resolve({
          success: false,
          mode,
          prediction: null,
          error:
            rawErr ||
            err.message ||
            "Failed to execute ML script. Ensure Python and required packages are installed.",
        });
      }

      try {
        const text = (stdout || "").trim();
        const result = text ? JSON.parse(text) : null;

        if (result && typeof result.success === "boolean") {
          return resolve(result);
        }

        if (result && result.error) {
          return resolve({
            success: false,
            mode,
            prediction: null,
            error: result.error,
          });
        }

        return resolve({
          success: true,
          mode,
          prediction: result,
          error: null,
        });
      } catch (parseError) {
        return resolve({
          success: false,
          mode,
          prediction: null,
          error: `Failed to parse ML output: ${parseError.message}`,
        });
      }
    });
  });
}

module.exports = { predict };
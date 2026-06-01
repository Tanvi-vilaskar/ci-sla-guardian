"use strict";

const { execFile } = require("child_process");
const path = require("path");

function predict(features, mode = "program") {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, "..", "backend", "predict.py");
    const inputString = JSON.stringify(features || {});

    execFile("python", [scriptPath, inputString, mode], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        return resolve({
          success: false,
          mode,
          prediction: null,
          error:
            stderr?.trim() ||
            err.message ||
            "Failed to execute ML script. Ensure Python and required packages are installed.",
        });
      }

      try {
        const result = JSON.parse((stdout || "").trim());

        if (typeof result.success === "boolean") {
          return resolve(result);
        }

        if (result.error) {
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
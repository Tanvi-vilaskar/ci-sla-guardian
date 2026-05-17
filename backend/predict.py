import sys
import json
import joblib
import os
import warnings

warnings.filterwarnings("ignore")


def safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def build_success(prediction, mode):
    return {
        "success": True,
        "mode": mode,
        "prediction": prediction,
        "error": None,
    }


def build_error(message, mode):
    return {
        "success": False,
        "mode": mode,
        "prediction": None,
        "error": message,
    }


def main():
    mode = sys.argv[2] if len(sys.argv) > 2 else "program"

    try:
        if len(sys.argv) < 2:
            print(json.dumps(build_error("No input data provided", mode)))
            return

        data = json.loads(sys.argv[1])
        base_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.abspath(os.path.join(base_dir, "..", "models"))

        if mode == "statement":
            scaler_path = os.path.join(models_dir, "scaler_X.pkl")
            model_path = os.path.join(models_dir, "random_forest_model.pkl")
            encoder_path = os.path.join(models_dir, "label_encoder.pkl")

            scaler = joblib.load(scaler_path)
            model = joblib.load(model_path)
            label_encoder = joblib.load(encoder_path)

            statement_type = str(data.get("statement_type", "")).upper().strip()
            statement_enc = data.get("statement_enc", None)

            if statement_enc is None:
                if not statement_type:
                    print(json.dumps(build_error("statement_type or statement_enc is required for statement mode", mode)))
                    return

                classes = [str(c).upper() for c in getattr(label_encoder, "classes_", [])]

                if statement_type not in classes:
                    alias_map = {
                        "EXEC SQL": "SQL",
                    }
                    mapped_type = alias_map.get(statement_type, statement_type)
                    if mapped_type in classes:
                        statement_type = mapped_type
                    else:
                        print(json.dumps(build_error(
                            f"Unsupported statement type '{statement_type}' for trained label encoder", mode
                        )))
                        return

                statement_enc = classes.index(statement_type)

            features = [[
                safe_int(statement_enc, 0),
                safe_int(data.get("is_loop", 0), 0),
                safe_int(data.get("loop_depth", 0), 0),
                safe_int(data.get("is_arithmetic", 0), 0),
                safe_int(data.get("is_io", 0), 0),
            ]]

            scaled = scaler.transform(features)
            pred = model.predict(scaled)[0]

            combined = round(float(pred[0]), 4)
            attributed = round(float(pred[1]), 4)
            executed = round(float(pred[2]), 4)

            prediction = {
                "statement_type": statement_type if statement_type else None,
                "statement_enc": safe_int(statement_enc, 0),
                "combined": combined,
                "attributed": attributed,
                "executed": executed,
                "cpu_time": combined,
            }

            print(json.dumps(build_success(prediction, mode)))
            return

        scaler_path = os.path.join(models_dir, "scaler.pkl")
        model_path = os.path.join(models_dir, "cobol_model.pkl")

        scaler = joblib.load(scaler_path)
        model = joblib.load(model_path)

        features = [[
            safe_float(data.get("maxLoopDepth", 0), 0),
            safe_float(data.get("nestedLoopCount", 0), 0),
            safe_float(data.get("totalPerforms", 0), 0),
            safe_float(data.get("fileIOCount", 0), 0),
            safe_float(data.get("ifCount", 0), 0),
            safe_float(data.get("functionCalls", 0), 0),
            safe_float(data.get("arithmeticOps", 0), 0),
        ]]

        scaled = scaler.transform(features)
        pred = model.predict(scaled)[0]

        cpu_time = round(float(pred[0]), 6)
        wait_percent = round(float(pred[1]), 4) if len(pred) > 1 else 0.0
        session_time = round(float(pred[2]), 6) if len(pred) > 2 else 0.0
        stretch_time = round(float(pred[3]), 6) if len(pred) > 3 else 0.0

        if session_time < cpu_time:
            session_time = round(cpu_time + stretch_time, 6)

        prediction = {
            "cpu_time": cpu_time,
            "wait_percent": wait_percent,
            "session_time": session_time,
            "stretch_time": stretch_time,
        }

        print(json.dumps(build_success(prediction, mode)))

    except Exception as e:
        print(json.dumps(build_error(str(e), mode)))
        sys.exit(1)


if __name__ == "__main__":
    main()
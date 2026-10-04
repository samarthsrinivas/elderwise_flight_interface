"""JSON command-line service the Elderwise desktop app uses to run the voice-age model.

Spawned by the Rust backend (src-tauri/src/age/) once per request; everything stays on device.

Usage:
  python ml/age_service.py status                      -> readiness JSON on stdout
  python ml/age_service.py download                    -> fetch WavLM weights into the HF cache
  python ml/age_service.py predict [--model PATH] < clip.wav
                                                       -> {"ageYears", "maeYears", "clipDurationS", "model"}

Errors are reported as {"error": {"code", "message"}} on stdout with exit code 2 so the caller
gets a stable code instead of a Python traceback.

Model file lookup order: --model, $ELDERWISE_AGE_MODEL, ml/age_model.joblib (next to this file).
"""
import argparse
import json
import os
import sys
import platform
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SR = 16000
MAX_SEC = 10  # training clips used the first 10 s
MIN_SEC = 1.0
MAE_YEARS = 7.6  # VoxCeleb held-out error; older voices run ~10 y low
MODEL_NAME = "wavlm-base-plus+svr-voxceleb"
SILENCE_RMS = 0.01
SILENCE_WINDOW = SR // 50  # 20 ms


class ServiceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def model_path(cli: str | None) -> Path:
    return Path(cli or os.environ.get("ELDERWISE_AGE_MODEL") or HERE / "age_model.joblib")


def weights_cached() -> bool:
    try:
        from huggingface_hub import try_to_load_from_cache
        from wavlm_mlx import REPO, REVISION
    except ImportError:
        return False
    hit = try_to_load_from_cache(REPO, "model.safetensors", revision=REVISION)
    return isinstance(hit, str) and Path(hit).exists()


def status(args) -> dict:
    deps = {}
    for mod in ("mlx.core", "av", "joblib", "sklearn", "numpy", "huggingface_hub"):
        try:
            m = __import__(mod)
            deps[mod.split(".")[0]] = getattr(m, "__version__", "ok")
        except Exception:  # noqa: BLE001 - any import failure means "not available"
            deps[mod.split(".")[0]] = None
    path = model_path(args.model)
    return {
        "python": platform.python_version(),
        "executable": sys.executable,
        "dependencies": deps,
        "dependenciesOk": all(v is not None for v in deps.values()),
        "modelPath": str(path),
        "modelPresent": path.is_file(),
        "weightsCached": weights_cached(),
        "maeYears": MAE_YEARS,
        "model": MODEL_NAME,
    }


def download(args) -> dict:
    from huggingface_hub import hf_hub_download
    from wavlm_mlx import REPO, REVISION

    path = hf_hub_download(REPO, "model.safetensors", revision=REVISION)
    return {"weightsPath": path, "weightsCached": True}


def trim_leading_silence(wav):
    """Drop everything before the first 20 ms window whose RMS exceeds SILENCE_RMS."""
    import numpy as np

    n = len(wav) // SILENCE_WINDOW
    if n == 0:
        return wav
    frames = wav[: n * SILENCE_WINDOW].reshape(n, SILENCE_WINDOW)
    rms = np.sqrt((frames * frames).mean(axis=1))
    loud = np.flatnonzero(rms > SILENCE_RMS)
    return wav if len(loud) == 0 else wav[int(loud[0]) * SILENCE_WINDOW :]


def predict(args) -> dict:
    path = model_path(args.model)
    if not path.is_file():
        raise ServiceError("model_missing", f"age model not found at {path}")
    if not weights_cached():
        raise ServiceError("weights_missing", "WavLM weights are not downloaded yet")

    raw = sys.stdin.buffer.read()
    if not raw:
        raise ServiceError("empty_input", "no audio bytes on stdin")

    import joblib
    import mlx.core as mx
    from embed import decode
    from wavlm_mlx import WavLM

    try:
        wav = decode(raw, max_sec=60)
    except Exception as e:  # noqa: BLE001 - PyAV raises many error types for bad containers
        raise ServiceError("decode_failed", f"could not decode audio: {e}") from e
    wav = trim_leading_silence(wav)[: SR * MAX_SEC]
    duration = len(wav) / SR
    if duration < MIN_SEC:
        raise ServiceError("too_short", f"need at least {MIN_SEC:.0f} s of speech, got {duration:.1f} s")

    # Clip lengths vary, so MLX's buffer cache never reuses and grows until the Mac panics. Cap it hard.
    mx.set_memory_limit(4 << 30)
    mx.set_cache_limit(256 << 20)
    reg = joblib.load(path)
    x = WavLM().embed(wav)[None].astype("float32")
    age = float(reg.predict(x)[0])
    return {
        "ageYears": round(age, 1),
        "maeYears": MAE_YEARS,
        "clipDurationS": round(duration, 2),
        "model": MODEL_NAME,
    }


def main(argv) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=("status", "download", "predict"))
    ap.add_argument("--model", help="path to age_model.joblib")
    args = ap.parse_args(argv)
    handler = {"status": status, "download": download, "predict": predict}[args.command]
    try:
        out = handler(args)
    except ServiceError as e:
        print(json.dumps({"error": {"code": e.code, "message": str(e)}}))
        return 2
    except Exception as e:  # noqa: BLE001 - last resort so the app sees JSON, not a traceback
        print(json.dumps({"error": {"code": "internal", "message": f"{type(e).__name__}: {e}"}}))
        return 2
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

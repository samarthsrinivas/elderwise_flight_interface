//! On-device voice-age estimate.
//!
//! The model (WavLM-base-plus embeddings on MLX + an SVR head trained on
//! VoxCeleb ages, see `ml/README.md`) runs as a short-lived Python subprocess:
//! `ml/age_service.py` reads a WAV clip on stdin and prints one JSON line.
//! Nothing leaves the machine. The Rust side only resolves paths, runs the
//! process with a timeout and maps its JSON onto typed results/errors.

pub mod error;

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

use crate::ai::error::ErrorPayload;
use error::AgeError;

const SCRIPT_NAME: &str = "age_service.py";
const MODEL_FILE: &str = "age_model.joblib";
const VENV_PYTHON: &str = ".venv-ml/bin/python";
/// Mirrors `MAE_YEARS` / `MODEL_NAME` in `ml/age_service.py`; the service
/// values win once it has answered, these only fill the status when it can't.
const MAE_YEARS: f64 = 7.6;
const MODEL_NAME: &str = "wavlm-base-plus+svr-voxceleb";

const STATUS_TIMEOUT: Duration = Duration::from_secs(60);
/// First prediction loads ~380 MB of weights into MLX; later ones take ~2 s.
const PREDICT_TIMEOUT: Duration = Duration::from_secs(180);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(900);
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const STDERR_TAIL_CHARS: usize = 600;

/// Where the Python side lives on this machine. Every field is best-effort;
/// `status` reports what is missing instead of failing.
#[derive(Debug, Clone)]
struct Layout {
    ml_dir: Option<PathBuf>,
    python: Option<PathBuf>,
    model: PathBuf,
}

/// Readiness of the age model as shown in Settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgeStatus {
    /// True only when Python, its packages, the WavLM weights and the SVR
    /// model are all present, i.e. `estimate_voice_age` can succeed.
    pub available: bool,
    pub ml_dir: Option<String>,
    pub python_path: Option<String>,
    pub python_version: Option<String>,
    pub model_path: String,
    pub model_present: bool,
    pub weights_cached: bool,
    pub dependencies_ok: bool,
    pub missing_dependencies: Vec<String>,
    pub mae_years: f64,
    pub model: String,
    /// Human-readable reason when `available` is false.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    python: String,
    dependencies: BTreeMap<String, Option<String>>,
    dependencies_ok: bool,
    model_present: bool,
    weights_cached: bool,
    mae_years: f64,
    model: String,
}

/// Result of one prediction, as stored on the voice task result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAgeEstimate {
    pub age_years: f64,
    pub mae_years: f64,
    pub clip_duration_s: f64,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeightsDownload {
    pub weights_path: String,
    pub weights_cached: bool,
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

fn resolve_ml_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(dir) = env_path("ELDERWISE_ML_DIR") {
        return Some(dir);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    // `cargo tauri dev` / `cargo test`: use the checked-out ml/ next to src-tauri.
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../ml")));
    if let Ok(resources) = app.path().resource_dir() {
        // tauri.conf.json bundles `../ml/*` which lands under `_up_/ml`.
        candidates.push(resources.join("_up_").join("ml"));
        candidates.push(resources.join("ml"));
    }
    candidates
        .into_iter()
        .find(|dir| dir.join(SCRIPT_NAME).is_file())
        .map(|dir| dir.canonicalize().unwrap_or(dir))
}

fn resolve_python(app: &tauri::AppHandle, ml_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(python) = env_path("ELDERWISE_AGE_PYTHON") {
        return Some(python);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(repo_root) = ml_dir.and_then(Path::parent) {
        candidates.push(repo_root.join(VENV_PYTHON));
    }
    if let Ok(data) = app.path().app_data_dir() {
        candidates.push(data.join(VENV_PYTHON));
    }
    // Deliberately no bare `python3` fallback: a Finder-launched app has a
    // minimal PATH and /usr/bin/python3 can pop the Xcode CLT installer.
    candidates.into_iter().find(|p| p.is_file())
}

fn resolve_model(app: &tauri::AppHandle, ml_dir: Option<&Path>) -> PathBuf {
    if let Some(model) = env_path("ELDERWISE_AGE_MODEL") {
        return model;
    }
    if let Some(in_repo) = ml_dir.map(|d| d.join(MODEL_FILE)) {
        if in_repo.is_file() {
            return in_repo;
        }
    }
    match app.path().app_data_dir() {
        Ok(data) => data.join("models").join(MODEL_FILE),
        Err(_) => ml_dir
            .map(|d| d.join(MODEL_FILE))
            .unwrap_or_else(|| PathBuf::from(MODEL_FILE)),
    }
}

fn resolve_layout(app: &tauri::AppHandle) -> Layout {
    let ml_dir = resolve_ml_dir(app);
    let python = resolve_python(app, ml_dir.as_deref());
    let model = resolve_model(app, ml_dir.as_deref());
    Layout {
        ml_dir,
        python,
        model,
    }
}

/// Paths needed to actually run the service, or the first thing that is missing.
fn ready_layout(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), AgeError> {
    let layout = resolve_layout(app);
    let ml_dir = layout.ml_dir.ok_or(AgeError::ScriptsMissing)?;
    let python = layout.python.ok_or(AgeError::PythonMissing)?;
    Ok((ml_dir, python, layout.model))
}

// ---------------------------------------------------------------------------
// Subprocess plumbing
// ---------------------------------------------------------------------------

fn drain(mut pipe: impl Read + Send + 'static) -> JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        // A read error here only truncates diagnostics; the exit status and
        // JSON parsing below decide success.
        let _ = pipe.read_to_end(&mut buf);
        buf
    })
}

fn stderr_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let text = text.trim();
    if text.chars().count() <= STDERR_TAIL_CHARS {
        return text.to_string();
    }
    let skip = text.chars().count() - STDERR_TAIL_CHARS;
    format!("…{}", text.chars().skip(skip).collect::<String>())
}

fn exit_label(code: Option<i32>) -> String {
    code.map_or_else(|| "signal".to_string(), |c| c.to_string())
}

/// Interpret what `age_service.py` printed. The service always answers with a
/// single JSON line on stdout (last line wins in case a library logs there)
/// and uses exit code 2 plus `{"error": ...}` for its own failures.
fn parse_service_output(
    exit_code: Option<i32>,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<Value, AgeError> {
    let text = String::from_utf8_lossy(stdout);
    let last_line = text.lines().rev().map(str::trim).find(|l| !l.is_empty());
    let Some(line) = last_line else {
        return Err(AgeError::Protocol(format!(
            "no output (exit {}): {}",
            exit_label(exit_code),
            stderr_tail(stderr)
        )));
    };
    let value: Value = serde_json::from_str(line).map_err(|e| {
        AgeError::Protocol(format!(
            "invalid JSON ({e}) in `{}` (exit {}): {}",
            line.chars().take(200).collect::<String>(),
            exit_label(exit_code),
            stderr_tail(stderr)
        ))
    })?;
    if let Some(err) = value.get("error") {
        let code = err.get("code").and_then(Value::as_str).unwrap_or("service");
        let message = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error")
            .to_string();
        return Err(AgeError::from_service(code, message));
    }
    if exit_code != Some(0) {
        return Err(AgeError::Protocol(format!(
            "exit {}: {}",
            exit_label(exit_code),
            stderr_tail(stderr)
        )));
    }
    Ok(value)
}

/// Run `python <script> <args>` with optional stdin bytes, bounded by
/// `timeout`. Blocking: call from `spawn_blocking`.
fn run_service(
    python: &Path,
    script: &Path,
    args: &[&str],
    stdin_bytes: Option<&[u8]>,
    timeout: Duration,
) -> Result<Value, AgeError> {
    let mut command = Command::new(python);
    command
        .arg(script)
        .args(args)
        .env("PYTHONUNBUFFERED", "1")
        .env("HF_HUB_DISABLE_TELEMETRY", "1")
        .stdin(if stdin_bytes.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = script.parent() {
        command.current_dir(dir);
    }
    let mut child = command
        .spawn()
        .map_err(|e| AgeError::Spawn(format!("{} ({})", e, python.display())))?;

    if let Some(bytes) = stdin_bytes {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AgeError::Spawn("stdin pipe unavailable".to_string()))?;
        let bytes = bytes.to_vec();
        std::thread::spawn(move || {
            // The service may exit before reading (e.g. model missing); an
            // EPIPE here is expected and the JSON error on stdout explains it.
            let _ = stdin.write_all(&bytes);
            // Dropping `stdin` closes the pipe so the child sees EOF.
        });
    }
    let stdout = child
        .stdout
        .take()
        .map(drain)
        .ok_or_else(|| AgeError::Spawn("stdout pipe unavailable".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .map(drain)
        .ok_or_else(|| AgeError::Spawn("stderr pipe unavailable".to_string()))?;

    let started = Instant::now();
    let status: ExitStatus = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() >= timeout => {
                // Best effort: the process is being abandoned either way. The
                // reader threads are left to finish on their own because a
                // grandchild may still hold the pipes open.
                let _ = child.kill();
                let _ = child.wait();
                return Err(AgeError::Timeout(timeout.as_secs()));
            }
            Ok(None) => std::thread::sleep(POLL_INTERVAL),
            Err(e) => return Err(AgeError::Spawn(e.to_string())),
        }
    };
    let stdout = stdout.join().unwrap_or_default();
    let stderr = stderr.join().unwrap_or_default();
    parse_service_output(status.code(), &stdout, &stderr)
}

fn parse_value<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, AgeError> {
    serde_json::from_value(value).map_err(|e| AgeError::Protocol(e.to_string()))
}

fn path_string(path: &Path) -> String {
    path.display().to_string()
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

fn unavailable_status(layout: &Layout, detail: String) -> AgeStatus {
    AgeStatus {
        available: false,
        ml_dir: layout.ml_dir.as_deref().map(path_string),
        python_path: layout.python.as_deref().map(path_string),
        python_version: None,
        model_path: path_string(&layout.model),
        model_present: layout.model.is_file(),
        weights_cached: false,
        dependencies_ok: false,
        missing_dependencies: Vec::new(),
        mae_years: MAE_YEARS,
        model: MODEL_NAME.to_string(),
        detail: Some(detail),
    }
}

fn status_from_service(layout: &Layout, service: ServiceStatus) -> AgeStatus {
    let missing: Vec<String> = service
        .dependencies
        .iter()
        .filter(|(_, version)| version.is_none())
        .map(|(name, _)| name.clone())
        .collect();
    let available = service.dependencies_ok && service.model_present && service.weights_cached;
    let detail = if !service.dependencies_ok {
        Some(format!(
            "Missing Python packages: {}. Install ml/requirements.txt into the environment.",
            missing.join(", ")
        ))
    } else if !service.model_present {
        Some(format!(
            "Age model not found at {}. Copy age_model.joblib there (see ml/README.md).",
            layout.model.display()
        ))
    } else if !service.weights_cached {
        Some("WavLM weights are not downloaded yet.".to_string())
    } else {
        None
    };
    AgeStatus {
        available,
        ml_dir: layout.ml_dir.as_deref().map(path_string),
        python_path: layout.python.as_deref().map(path_string),
        python_version: Some(service.python),
        model_path: path_string(&layout.model),
        model_present: service.model_present,
        weights_cached: service.weights_cached,
        dependencies_ok: service.dependencies_ok,
        missing_dependencies: missing,
        mae_years: service.mae_years,
        model: service.model,
        detail,
    }
}

fn model_status(app: &tauri::AppHandle) -> AgeStatus {
    let layout = resolve_layout(app);
    let (Some(ml_dir), Some(python)) = (layout.ml_dir.clone(), layout.python.clone()) else {
        let reason = if layout.ml_dir.is_none() {
            AgeError::ScriptsMissing
        } else {
            AgeError::PythonMissing
        };
        return unavailable_status(&layout, reason.to_string());
    };
    let model = path_string(&layout.model);
    let outcome = run_service(
        &python,
        &ml_dir.join(SCRIPT_NAME),
        &["status", "--model", &model],
        None,
        STATUS_TIMEOUT,
    )
    .and_then(parse_value::<ServiceStatus>);
    match outcome {
        Ok(service) => status_from_service(&layout, service),
        Err(err) => unavailable_status(&layout, err.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

async fn blocking<T, F>(work: F) -> Result<T, ErrorPayload>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AgeError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| ErrorPayload::from(AgeError::Join(e.to_string())))?
        .map_err(ErrorPayload::from)
}

/// Readiness of the on-device age model. Never fails: missing pieces are
/// reported in the payload so Settings can explain what to install.
#[tauri::command]
pub async fn age_model_status(app: tauri::AppHandle) -> Result<AgeStatus, ErrorPayload> {
    blocking(move || Ok(model_status(&app))).await
}

/// Fetch the WavLM weights into the Hugging Face cache (one-off, ~380 MB).
#[tauri::command]
pub async fn age_download_weights(app: tauri::AppHandle) -> Result<WeightsDownload, ErrorPayload> {
    blocking(move || {
        let (ml_dir, python, _) = ready_layout(&app)?;
        run_service(
            &python,
            &ml_dir.join(SCRIPT_NAME),
            &["download"],
            None,
            DOWNLOAD_TIMEOUT,
        )
        .and_then(parse_value::<WeightsDownload>)
    })
    .await
}

/// Estimate speaker age from a 16 kHz mono PCM WAV clip. Audio never leaves
/// the device; only the first ~10 s after leading silence are used.
#[tauri::command]
pub async fn estimate_voice_age(
    app: tauri::AppHandle,
    wav: Vec<u8>,
) -> Result<VoiceAgeEstimate, ErrorPayload> {
    if wav.is_empty() {
        return Err(AgeError::EmptyInput.into());
    }
    blocking(move || {
        let (ml_dir, python, model) = ready_layout(&app)?;
        let model = path_string(&model);
        run_service(
            &python,
            &ml_dir.join(SCRIPT_NAME),
            &["predict", "--model", &model],
            Some(&wav),
            PREDICT_TIMEOUT,
        )
        .and_then(parse_value::<VoiceAgeEstimate>)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_prediction_payload() {
        let stdout = br#"{"ageYears": 51.1, "maeYears": 7.6, "clipDurationS": 6.0, "model": "wavlm-base-plus+svr-voxceleb"}"#;
        let value = parse_service_output(Some(0), stdout, b"").expect("ok");
        let estimate: VoiceAgeEstimate = parse_value(value).expect("shape");
        assert_eq!(
            estimate,
            VoiceAgeEstimate {
                age_years: 51.1,
                mae_years: 7.6,
                clip_duration_s: 6.0,
                model: MODEL_NAME.to_string(),
            }
        );
    }

    #[test]
    fn uses_last_non_empty_stdout_line() {
        let stdout = b"peak 0.80 GB\n\n{\"ok\": true}\n\n";
        let value = parse_service_output(Some(0), stdout, b"").expect("ok");
        assert_eq!(value["ok"], Value::Bool(true));
    }

    #[test]
    fn maps_service_error_json() {
        let stdout = br#"{"error": {"code": "too_short", "message": "need at least 1 s of speech, got 0.4 s"}}"#;
        let err = parse_service_output(Some(2), stdout, b"").unwrap_err();
        assert_eq!(err.code(), "too_short");
        assert_eq!(err.to_string(), "need at least 1 s of speech, got 0.4 s");

        let stdout =
            br#"{"error": {"code": "model_missing", "message": "age model not found at /x"}}"#;
        let err = parse_service_output(Some(2), stdout, b"").unwrap_err();
        assert_eq!(err.code(), "model_missing");
    }

    #[test]
    fn traceback_without_json_is_protocol_error() {
        let err =
            parse_service_output(Some(1), b"", b"Traceback...\nValueError: boom").unwrap_err();
        assert_eq!(err.code(), "protocol");
        assert!(err.to_string().contains("ValueError: boom"));

        let err = parse_service_output(Some(0), b"not json", b"").unwrap_err();
        assert_eq!(err.code(), "protocol");
    }

    #[test]
    fn non_zero_exit_with_plain_json_is_protocol_error() {
        let err = parse_service_output(Some(3), b"{\"ok\": true}", b"warn").unwrap_err();
        assert_eq!(err.code(), "protocol");
        assert!(err.to_string().contains("exit 3"));
    }

    #[test]
    fn stderr_tail_keeps_the_end() {
        let long = "a".repeat(STDERR_TAIL_CHARS) + "END";
        let tail = stderr_tail(long.as_bytes());
        assert!(tail.starts_with('…'));
        assert!(tail.ends_with("END"));
        assert_eq!(stderr_tail(b"  short \n"), "short");
    }

    #[test]
    fn status_from_service_explains_missing_pieces() {
        let layout = Layout {
            ml_dir: Some(PathBuf::from("/repo/ml")),
            python: Some(PathBuf::from("/repo/.venv-ml/bin/python")),
            model: PathBuf::from("/repo/ml/age_model.joblib"),
        };
        let base = ServiceStatus {
            python: "3.12.14".to_string(),
            dependencies: BTreeMap::from([
                ("mlx".to_string(), Some("0.32.3".to_string())),
                ("av".to_string(), None),
            ]),
            dependencies_ok: false,
            model_present: false,
            weights_cached: false,
            mae_years: 7.6,
            model: MODEL_NAME.to_string(),
        };
        let status = status_from_service(&layout, base.clone());
        assert!(!status.available);
        assert_eq!(status.missing_dependencies, vec!["av".to_string()]);
        assert!(status.detail.as_deref().unwrap().contains("av"));

        let status = status_from_service(
            &layout,
            ServiceStatus {
                dependencies_ok: true,
                ..base.clone()
            },
        );
        assert!(status
            .detail
            .as_deref()
            .unwrap()
            .contains("/repo/ml/age_model.joblib"));

        let status = status_from_service(
            &layout,
            ServiceStatus {
                dependencies_ok: true,
                model_present: true,
                ..base.clone()
            },
        );
        assert!(status.detail.as_deref().unwrap().contains("weights"));

        let status = status_from_service(
            &layout,
            ServiceStatus {
                dependencies_ok: true,
                model_present: true,
                weights_cached: true,
                ..base
            },
        );
        assert!(status.available);
        assert_eq!(status.detail, None);
        assert_eq!(status.python_version.as_deref(), Some("3.12.14"));
    }

    #[test]
    fn status_serialises_camel_case() {
        let layout = Layout {
            ml_dir: None,
            python: None,
            model: PathBuf::from("/data/models/age_model.joblib"),
        };
        let json =
            serde_json::to_value(unavailable_status(&layout, "nope".to_string())).expect("json");
        assert_eq!(json["available"], Value::Bool(false));
        assert_eq!(json["modelPath"], "/data/models/age_model.joblib");
        assert_eq!(json["maeYears"], 7.6);
        assert_eq!(json["detail"], "nope");
        assert!(json.get("ml_dir").is_none());
    }

    /// Exercise the real subprocess plumbing with /bin/sh standing in for
    /// Python: stdin is delivered, stdout is parsed, timeouts kill the child.
    #[cfg(unix)]
    mod subprocess {
        use super::*;

        fn script(body: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!(
                "elderwise-age-test-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).expect("tmp dir");
            let path = dir.join("fake_service.sh");
            std::fs::write(&path, body).expect("write script");
            path
        }

        #[test]
        fn delivers_stdin_and_parses_stdout() {
            let path = script(
                "n=$(wc -c | tr -d ' ')\nprintf '{\"bytes\": %s, \"cmd\": \"%s\"}\\n' \"$n\" \"$1\"\n",
            );
            let wav = vec![7u8; 100_000];
            let value = run_service(
                Path::new("/bin/sh"),
                &path,
                &["predict"],
                Some(&wav),
                Duration::from_secs(10),
            )
            .expect("runs");
            assert_eq!(value["bytes"], Value::from(100_000));
            assert_eq!(value["cmd"], "predict");
        }

        #[test]
        fn early_exit_without_reading_stdin_still_reports_json() {
            let path = script(
                "printf '{\"error\": {\"code\": \"model_missing\", \"message\": \"gone\"}}\\n'\nexit 2\n",
            );
            let wav = vec![1u8; 2_000_000];
            let err = run_service(
                Path::new("/bin/sh"),
                &path,
                &["predict"],
                Some(&wav),
                Duration::from_secs(10),
            )
            .unwrap_err();
            assert_eq!(err.code(), "model_missing");
            assert_eq!(err.to_string(), "gone");
        }

        #[test]
        fn kills_child_on_timeout() {
            let path = script("sleep 30\n");
            let started = Instant::now();
            let err = run_service(
                Path::new("/bin/sh"),
                &path,
                &["status"],
                None,
                Duration::from_millis(300),
            )
            .unwrap_err();
            assert_eq!(err.code(), "timeout");
            assert!(started.elapsed() < Duration::from_secs(5));
        }

        #[test]
        fn missing_interpreter_is_spawn_error() {
            let err = run_service(
                Path::new("/definitely/not/python"),
                Path::new("/dev/null"),
                &["status"],
                None,
                Duration::from_secs(1),
            )
            .unwrap_err();
            assert_eq!(err.code(), "spawn");
        }
    }
}

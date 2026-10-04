// Rust side of Elderwise: saves each "Take off" attempt on this device.
//
// Each attempt arrives as one binary message: [4-byte little-endian JSON length][result JSON][WAV].
// It is written to <app data folder>/sessions as a WAV file, a JSON file, and one row in attempts.csv.
// Nothing leaves the device.

use serde::Serialize;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

/// CSV column name, then the matching key in the result JSON sent by the game.
const CSV_COLUMNS: [(&str, &str); 13] = [
    ("saved_at", "savedAt"),
    ("attempt", "attempt"),
    ("phonation_s", "phonationTimeSec"),
    ("voiced_s", "totalVoicedSec"),
    ("mean_f0_hz", "meanF0Hz"),
    ("f0_sd_semitones", "f0SdSemitones"),
    ("loudness_sd_db", "loudnessSdDb"),
    ("noise_floor_dbfs", "noiseFloorDbfs"),
    ("clipped_fraction", "clippedFraction"),
    ("sample_rate", "sampleRate"),
    ("quality_flags", "qualityFlags"),
    ("audio_path", "audioPath"),
    ("voiced_start_s", "voicedStartSec"),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveReply {
    wav_path: String,
    folder: String,
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not find the app data folder: {e}"))?
        .join("sessions");
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// One CSV cell: empty for missing values, lists joined with ";", text quoted when needed.
fn csv_cell(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => {
            if s.contains(',') || s.contains('"') || s.contains('\n') {
                format!("\"{}\"", s.replace('"', "\"\""))
            } else {
                s.clone()
            }
        }
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(";"),
        Some(other) => other.to_string(),
    }
}

fn append_csv(path: &Path, meta: &Value, wav_file: &str) -> Result<(), String> {
    let new_file = !path.exists();
    let mut out = String::new();
    if new_file {
        let header: Vec<&str> = CSV_COLUMNS.iter().map(|(col, _)| *col).collect();
        out.push_str(&header.join(","));
        out.push_str(",wav_file\r\n");
    }
    let row: Vec<String> = CSV_COLUMNS.iter().map(|(_, key)| csv_cell(meta.get(*key))).collect();
    out.push_str(&row.join(","));
    out.push(',');
    out.push_str(wav_file);
    out.push_str("\r\n");

    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("could not open {}: {e}", path.display()))?;
    f.write_all(out.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_attempt(app: AppHandle, request: Request) -> Result<SaveReply, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("expected the recording as raw bytes".into());
    };
    if body.len() < 4 {
        return Err("the upload was empty".into());
    }
    let json_len = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    if body.len() < 4 + json_len {
        return Err("the upload was cut short".into());
    }
    let meta: Value = serde_json::from_slice(&body[4..4 + json_len])
        .map_err(|e| format!("the result data could not be read: {e}"))?;
    let wav = &body[4 + json_len..];
    if wav.len() < 44 || &wav[0..4] != b"RIFF" {
        return Err("the recording is not a WAV file".into());
    }

    let dir = sessions_dir(&app)?;
    // keep file names safe: only letters, digits and dashes from the timestamp
    let stamp: String = meta
        .get("savedAt")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    let attempt = meta.get("attempt").and_then(Value::as_u64).unwrap_or(0);
    let base = format!("aaah_{stamp}_attempt{attempt}");
    let wav_name = format!("{base}.wav");
    let wav_path = dir.join(&wav_name);

    fs::write(&wav_path, wav).map_err(|e| format!("could not save the recording: {e}"))?;
    let pretty = serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{base}.json")), pretty).map_err(|e| format!("could not save the results: {e}"))?;
    append_csv(&dir.join("attempts.csv"), &meta, &wav_name)?;

    Ok(SaveReply {
        wav_path: wav_path.to_string_lossy().into_owned(),
        folder: dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn open_sessions_folder(app: AppHandle) -> Result<String, String> {
    let dir = sessions_dir(&app)?;
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("could not open the folder: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_attempt, open_sessions_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

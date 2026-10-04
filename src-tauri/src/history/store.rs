use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde_json::Value;

use super::error::HistoryError;

const FILE_NAME: &str = "history.jsonl";

/// Append one record as a single JSON line. `serde_json::to_string` escapes
/// embedded newlines, so every record occupies exactly one line.
pub fn append(dir: &Path, record: &Value) -> Result<(), HistoryError> {
    fs::create_dir_all(dir).map_err(|err| HistoryError::Io(err.to_string()))?;
    let line =
        serde_json::to_string(record).map_err(|err| HistoryError::Serialize(err.to_string()))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(FILE_NAME))
        .map_err(|err| HistoryError::Io(err.to_string()))?;
    writeln!(file, "{line}").map_err(|err| HistoryError::Io(err.to_string()))
}

/// Read every stored record in append order. Unparseable lines are skipped
/// so one corrupt line never bricks the history screen; schema validation
/// happens in the frontend (Zod at the IPC boundary).
pub fn read_all(dir: &Path) -> Result<Vec<Value>, HistoryError> {
    let raw = match fs::read_to_string(dir.join(FILE_NAME)) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(HistoryError::Io(err.to_string())),
    };
    Ok(raw
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect())
}

/// Remove the whole store; missing file counts as already cleared.
pub fn clear(dir: &Path) -> Result<(), HistoryError> {
    match fs::remove_file(dir.join(FILE_NAME)) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(HistoryError::Io(err.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hw-history-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn missing_file_reads_empty() {
        assert_eq!(read_all(&temp_dir("missing")).unwrap(), Vec::<Value>::new());
    }

    #[test]
    fn append_then_read_roundtrips_in_order() {
        let dir = temp_dir("roundtrip");
        let first = json!({"id": "a", "recordedAt": "2026-07-05T00:00:00Z", "reps": 12});
        let second = json!({"id": "b", "recordedAt": "2026-07-05T01:00:00Z", "reps": 14});
        append(&dir, &first).unwrap();
        append(&dir, &second).unwrap();
        assert_eq!(read_all(&dir).unwrap(), vec![first, second]);
    }

    #[test]
    fn newlines_inside_strings_stay_on_one_line() {
        let dir = temp_dir("newline");
        let record = json!({"id": "a", "note": "line one\nline two"});
        append(&dir, &record).unwrap();
        let stored = read_all(&dir).unwrap();
        assert_eq!(stored, vec![record]);
    }

    #[test]
    fn corrupt_lines_are_skipped() {
        let dir = temp_dir("corrupt");
        let good = json!({"id": "keep"});
        append(&dir, &good).unwrap();
        let path = dir.join(FILE_NAME);
        let mut raw = fs::read_to_string(&path).unwrap();
        raw.push_str("not json at all\n");
        fs::write(&path, raw).unwrap();
        append(&dir, &good).unwrap();
        assert_eq!(read_all(&dir).unwrap(), vec![good.clone(), good]);
    }

    #[test]
    fn clear_removes_store_and_tolerates_missing() {
        let dir = temp_dir("clear");
        clear(&dir).unwrap();
        append(&dir, &json!({"id": "a"})).unwrap();
        clear(&dir).unwrap();
        assert_eq!(read_all(&dir).unwrap(), Vec::<Value>::new());
    }
}

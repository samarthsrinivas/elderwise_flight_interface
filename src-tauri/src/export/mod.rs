use std::path::Path;

use serde::Serialize;

/// Error payload crossing the Tauri IPC boundary. `code` is a stable
/// discriminant the frontend narrows on; `message` is human-readable.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("failed to write the PDF: {0}")]
    Io(String),
    #[error("background task failed: {0}")]
    Join(String),
}

impl ExportError {
    const fn code(&self) -> &'static str {
        match self {
            Self::Io(_) => "io",
            Self::Join(_) => "join",
        }
    }
}

impl From<ExportError> for ErrorPayload {
    fn from(err: ExportError) -> Self {
        Self {
            code: err.code(),
            message: err.to_string(),
        }
    }
}

/// Resolve a destination that may arrive as a plain path or as a `file://`
/// URL. The iOS document picker hands back a URL, and `Path::new("file:///x")`
/// is a *relative* path whose first component is `file:` — it fails with a
/// bare ENOENT that reads like a permissions problem.
fn resolve_destination(raw: &str) -> std::path::PathBuf {
    if raw.starts_with("file://") {
        if let Ok(url) = url::Url::parse(raw) {
            if let Ok(path) = url.to_file_path() {
                return path;
            }
        }
    }
    std::path::PathBuf::from(raw)
}

fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), ExportError> {
    // Deliberately does NOT create missing parents. Both callers hand over a
    // directory that already exists — one from the save dialog, one from the
    // OS path resolver — so a missing parent means something is genuinely
    // wrong, and silently creating directories under a location the user
    // picked would be worse than reporting it. Pinned by
    // `missing_parent_directory_maps_to_io_code`.
    std::fs::write(path, bytes).map_err(|err| ExportError::Io(err.to_string()))
}

/// Where a report is written when the user is not picking a location.
///
/// On macOS that is the Downloads folder. On iOS there is no Downloads
/// directory and no writable location outside the app container, so it is the
/// app's own Documents directory — which, with `UIFileSharingEnabled` and
/// `LSSupportsOpeningDocumentsInPlace` in Info.ios.plist, is exactly the
/// directory the participant can reach from the Files app to hand the report
/// on. Resolving this in Rust keeps the platform decision where the platform
/// is actually known, instead of guessing from the webview.
#[tauri::command]
pub async fn export_default_dir(app: tauri::AppHandle) -> Result<String, ErrorPayload> {
    use tauri::Manager;

    let resolver = app.path();
    #[cfg(target_os = "ios")]
    let dir = resolver.document_dir();
    #[cfg(not(target_os = "ios"))]
    let dir = resolver.download_dir();

    dir.map(|path| path.to_string_lossy().into_owned())
        .map_err(|err| ErrorPayload::from(ExportError::Io(err.to_string())))
}

/// How the native save dialog behaves on this platform.
///
/// On macOS the dialog hands back a path the app then writes to. iOS has no
/// such interface: `UIDocumentPickerViewController` in `.exportToService` mode
/// only *moves a file the app already has* to a location the user picks, so
/// tauri-plugin-dialog stages an empty file in the app's Documents directory,
/// exports that, and returns the URL of the copy in the destination provider's
/// container. Writing to that URL afterwards needs
/// `startAccessingSecurityScopedResource` from Swift and fails without it —
/// leaving the participant with a zero-byte report and an error. The frontend
/// therefore has to know which contract it is dealing with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DialogMode {
    /// The dialog returns a writable path; write the bytes to it afterwards.
    WriteToPickedPath,
    /// The dialog exports a file the app staged beforehand; write the bytes
    /// into the default directory FIRST, then open the dialog.
    ExportStagedFile,
}

impl DialogMode {
    const fn current() -> Self {
        if cfg!(target_os = "ios") {
            Self::ExportStagedFile
        } else {
            Self::WriteToPickedPath
        }
    }
}

#[tauri::command]
pub const fn export_dialog_mode() -> DialogMode {
    DialogMode::current()
}

/// Write PDF bytes to a path the user picked in the native save dialog.
/// Runs off the async runtime; plain `std::fs`, matching the history store.
#[tauri::command]
pub async fn export_save_pdf(path: String, bytes: Vec<u8>) -> Result<(), ErrorPayload> {
    tauri::async_runtime::spawn_blocking(move || write_bytes(&resolve_destination(&path), &bytes))
        .await
        .map_err(|err| ErrorPayload::from(ExportError::Join(err.to_string())))?
        .map_err(ErrorPayload::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dialog_mode_matches_the_platform_contract() {
        // iOS exports a staged file; every other platform hands back a
        // writable path. Getting this backwards on iOS ships a zero-byte
        // report to whatever location the participant picked.
        let expected = if cfg!(target_os = "ios") {
            DialogMode::ExportStagedFile
        } else {
            DialogMode::WriteToPickedPath
        };
        assert_eq!(export_dialog_mode(), expected);
    }

    #[test]
    fn the_dialog_mode_serializes_as_the_kebab_case_contract() {
        assert_eq!(
            serde_json::to_string(&DialogMode::ExportStagedFile).unwrap(),
            "\"export-staged-file\""
        );
        assert_eq!(
            serde_json::to_string(&DialogMode::WriteToPickedPath).unwrap(),
            "\"write-to-picked-path\""
        );
    }

    #[test]
    fn a_file_url_destination_resolves_to_a_real_path() {
        // The iOS document picker hands back a URL. Path::new("file:///a/b")
        // is a RELATIVE path whose first component is "file:", so writing it
        // fails with a bare ENOENT that reads like a permissions problem.
        assert_eq!(
            resolve_destination("file:///tmp/report.pdf"),
            std::path::PathBuf::from("/tmp/report.pdf")
        );
    }

    #[test]
    fn a_plain_path_destination_is_left_alone() {
        assert_eq!(
            resolve_destination("/tmp/report.pdf"),
            std::path::PathBuf::from("/tmp/report.pdf")
        );
    }

    fn temp_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("hw-export-{tag}-{}.pdf", std::process::id()))
    }

    #[test]
    fn writes_bytes_to_the_given_path() {
        let path = temp_path("write");
        write_bytes(&path, b"%PDF-1.3 fake").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.3 fake");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn overwrites_an_existing_file() {
        let path = temp_path("overwrite");
        write_bytes(&path, b"old").unwrap();
        write_bytes(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_parent_directory_maps_to_io_code() {
        let path = std::env::temp_dir()
            .join(format!("hw-export-missing-{}", std::process::id()))
            .join("nested")
            .join("out.pdf");
        let err = write_bytes(&path, b"x").unwrap_err();
        assert_eq!(ErrorPayload::from(err).code, "io");
    }
}

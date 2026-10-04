import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { z } from "zod";
import { toMessage } from "../../lib/errors";

/**
 * How the platform's save dialog behaves, reported by Rust where the platform
 * is actually known. See `DialogMode` in src-tauri/src/export/mod.rs.
 */
const dialogModeSchema = z.enum(["write-to-picked-path", "export-staged-file"]);
export type DialogMode = z.infer<typeof dialogModeSchema>;

const errorPayloadSchema = z.object({
  code: z.enum(["io", "join"]),
  message: z.string(),
});

export type ExportErrorCode = z.infer<typeof errorPayloadSchema>["code"];

/** Typed error surfaced by the export command layer. */
export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = "ExportError";
    this.code = code;
  }
}

/** Raised when the app runs outside a Tauri window or a response is malformed. */
export class ExportUnavailableError extends Error {
  constructor(cause: string) {
    super(`PDF export unavailable: ${cause}`);
    this.name = "ExportUnavailableError";
  }
}

function toTypedError(raised: unknown): Error {
  const payload = errorPayloadSchema.safeParse(raised);
  if (payload.success) {
    return new ExportError(payload.data.code, payload.data.message);
  }
  return new ExportUnavailableError(toMessage(raised));
}

async function dialogMode(): Promise<DialogMode> {
  let raw: unknown;
  try {
    raw = await invoke("export_dialog_mode");
  } catch (raised) {
    throw new ExportUnavailableError(toMessage(raised));
  }
  const parsed = dialogModeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ExportUnavailableError(`unknown save dialog mode: ${String(raw)}`);
  }
  return parsed.data;
}

/**
 * The app's own report directory joined with a bare file name: Downloads on
 * macOS, the app's Documents container on iPadOS. On iPadOS this is also the
 * exact directory tauri-plugin-dialog stages its placeholder into, which is
 * what lets `savePdf` pre-empt it with the real bytes.
 */
async function stagedPath(fileName: string): Promise<string> {
  try {
    return await join(await invoke<string>("export_default_dir"), fileName);
  } catch (raised) {
    throw new ExportUnavailableError(toMessage(raised));
  }
}

async function pickDestination(defaultFileName: string): Promise<string | null> {
  try {
    return await save({
      defaultPath: defaultFileName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
  } catch (raised) {
    throw new ExportUnavailableError(toMessage(raised));
  }
}

async function writePdf(path: string, bytes: Uint8Array): Promise<void> {
  try {
    await invoke("export_save_pdf", { path, bytes: Array.from(bytes) });
  } catch (raised) {
    throw toTypedError(raised);
  }
}

/**
 * Save the report where the user chooses.
 *
 * Two platform contracts, decided in Rust:
 *
 * - `write-to-picked-path` (macOS): the dialog returns a writable path and the
 *   bytes go to it afterwards.
 * - `export-staged-file` (iPadOS): the document picker only exports a file the
 *   app already has, so the real PDF is written into the app's Documents
 *   directory FIRST and the picker exports that. Writing after the picker -
 *   the desktop order - targets a URL inside the destination provider's
 *   container that the app has no permission to write, so the participant is
 *   handed a zero-byte report and an error. Staging first also means a
 *   cancelled picker still leaves the report in the app's Files folder rather
 *   than losing it.
 *
 * Resolves false when the user cancels the dialog.
 */
export async function savePdf(
  defaultFileName: string,
  bytes: Uint8Array,
): Promise<boolean> {
  if ((await dialogMode()) === "export-staged-file") {
    // Must be the same directory tauri-plugin-dialog stages into, and the
    // same bare file name it derives from `defaultPath` - the plugin only
    // skips writing its empty placeholder when the file is already there.
    await writePdf(await stagedPath(defaultFileName), bytes);
    return (await pickDestination(defaultFileName)) !== null;
  }

  const path = await pickDestination(defaultFileName);
  if (path === null) return false;
  await writePdf(path, bytes);
  return true;
}

/**
 * Write the bytes straight into the platform's report directory without a
 * dialog - the hands-free voice path, where a native save panel would require
 * the mouse. Returns the full path written.
 *
 * The directory is resolved in Rust, where the platform is actually known:
 * Downloads on macOS, and the app's own Documents directory on iPadOS, which
 * has no Downloads folder and no writable location outside the container.
 * Info.ios.plist exposes that directory in the Files app so the report can
 * still be handed on.
 */
export async function savePdfToDownloads(
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const path = await stagedPath(fileName);
  await writePdf(path, bytes);
  return path;
}

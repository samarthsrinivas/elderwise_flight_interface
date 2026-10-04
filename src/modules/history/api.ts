import { invoke } from "@tauri-apps/api/core";
import { toMessage } from "../../lib/errors";
import {
  type HistoryErrorCode,
  type SessionRecord,
  errorPayloadSchema,
  parseSessionRecords,
} from "./types";

/** Typed error surfaced by the history command layer. */
export class HistoryError extends Error {
  readonly code: HistoryErrorCode;

  constructor(code: HistoryErrorCode, message: string) {
    super(message);
    this.name = "HistoryError";
    this.code = code;
  }
}

/** Raised when the app runs outside a Tauri window or a response is malformed. */
export class HistoryUnavailableError extends Error {
  constructor(cause: string) {
    super(`History store unavailable: ${cause}`);
    this.name = "HistoryUnavailableError";
  }
}

function toTypedError(raised: unknown): Error {
  const payload = errorPayloadSchema.safeParse(raised);
  if (payload.success) {
    return new HistoryError(payload.data.code, payload.data.message);
  }
  return new HistoryUnavailableError(toMessage(raised));
}

/**
 * All stored records, newest first. Records that fail schema validation
 * are dropped, matching the store's tolerant-read contract.
 */
export async function readSessions(): Promise<SessionRecord[]> {
  let raw: unknown;
  try {
    raw = await invoke("history_read");
  } catch (raised) {
    throw toTypedError(raised);
  }
  return parseSessionRecords(raw);
}

export async function appendSession(record: SessionRecord): Promise<void> {
  try {
    await invoke("history_append", { record });
  } catch (raised) {
    throw toTypedError(raised);
  }
}

export async function clearSessions(): Promise<void> {
  try {
    await invoke("history_clear");
  } catch (raised) {
    throw toTypedError(raised);
  }
}

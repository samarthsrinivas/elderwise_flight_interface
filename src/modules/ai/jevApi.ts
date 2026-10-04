import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

const jevKeyStatusSchema = z.discriminatedUnion("configured", [
  z.object({ configured: z.literal(true), source: z.enum(["keychain", "environment"]) }).strict(),
  z.object({ configured: z.literal(false), source: z.null() }).strict(),
]);
export type JevKeyStatus = z.infer<typeof jevKeyStatusSchema>;

/** Status contains only credential availability; Rust never returns the key. */
export async function fetchJevKeyStatus(): Promise<JevKeyStatus> {
  return jevKeyStatusSchema.parse(await invoke("questionnaire_key_status", {}));
}

export async function setJevKey(key: string): Promise<void> {
  await invoke("questionnaire_set_key", { key });
}

export async function clearJevKey(): Promise<void> {
  await invoke("questionnaire_clear_key", {});
}

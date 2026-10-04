import { z } from "zod";
import { assessmentSessionSchema, type AssessmentSession } from "../assessment/types";

export const sessionRecordSchema = assessmentSessionSchema;
export type SessionRecord = AssessmentSession;

export function parseSessionRecords(raw: unknown): SessionRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: SessionRecord[] = [];
  for (const entry of raw) {
    const parsed = sessionRecordSchema.safeParse(entry);
    if (parsed.success) {
      records.push(parsed.data);
    }
  }
  // Sort newest first
  return records.sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
}

export const historyErrorCodes = ["path", "io", "serialize", "join"] as const;
export type HistoryErrorCode = (typeof historyErrorCodes)[number];

export const errorPayloadSchema = z.object({
  code: z.enum(historyErrorCodes),
  message: z.string(),
});

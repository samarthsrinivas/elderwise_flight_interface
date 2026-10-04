/**
 * Thin wrapper around the Web Speech API.
 *
 * - Text-to-speech (SpeechSynthesis) is broadly available in the Tauri
 *   webviews (WKWebView / WebView2 / WebKitGTK).
 * - Speech recognition (SpeechRecognition) is not the packaged-app path. Some
 *   embedded webviews expose a constructor but fail or use a separate OS speech
 *   permission flow, so Tauri builds rely on provider-backed WAV transcription.
 *
 * Roadmap: replace recognition with a native STT plugin (OS speech services
 * or a local whisper.cpp sidecar) so the voice-led flow works everywhere.
 */

import { synthesizeSpeech } from "../ai/api";

export function isSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let activeCloudAudio: HTMLAudioElement | null = null;
let activeCloudUrl: string | null = null;
let activeCloudSpeech: Promise<void> | null = null;

type RecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>>;
}

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | RecognitionCtor
    | undefined;
}

function isTauriRuntime(): boolean {
  const g = globalThis as unknown as Record<string, unknown>;
  return g.isTauri === true || typeof g.__TAURI_INTERNALS__ === "object";
}

export function isRecognitionSupported(): boolean {
  if (isTauriRuntime()) return false;
  return recognitionCtor() !== undefined;
}

function cleanupCloudAudio(): void {
  if (activeCloudAudio) {
    activeCloudAudio.pause();
    activeCloudAudio.src = "";
    activeCloudAudio = null;
  }
  if (activeCloudUrl) {
    URL.revokeObjectURL(activeCloudUrl);
    activeCloudUrl = null;
  }
  activeCloudSpeech = null;
}

function speechMimeType(bytes: Uint8Array): string {
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return "audio/wav";
  }
  return "audio/mpeg";
}

async function speakWithCloudVoice(text: string, lang: string): Promise<void> {
  const audioBytes = await synthesizeSpeech(text, lang);
  if (audioBytes.byteLength === 0) return;
  cleanupCloudAudio();
  if (isSynthesisSupported()) window.speechSynthesis.cancel();
  const blob = new Blob([audioBytes], { type: speechMimeType(audioBytes) });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  activeCloudAudio = audio;
  activeCloudUrl = url;
  activeCloudSpeech = new Promise<void>((resolve, reject) => {
    const finish = () => {
      cleanupCloudAudio();
      resolve();
    };
    const fail = () => {
      cleanupCloudAudio();
      reject(new Error("Cloud speech playback failed"));
    };
    audio.onended = finish;
    audio.onerror = fail;
    void audio.play().catch(fail);
  });
  await activeCloudSpeech;
}

function speakWithSystemVoice(text: string, lang: string): Promise<void> {
  if (!isSynthesisSupported()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.95;
    utterance.onend = finish;
    utterance.onerror = finish;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const timeout = setTimeout(finish, Math.max(5000, Math.min(45000, words * 750)));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

/** Speak `text` aloud. Resolves when the utterance finishes (or immediately if TTS is unavailable). */
export async function speak(text: string, lang = "en-US"): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    await speakWithCloudVoice(trimmed, lang);
  } catch {
    await speakWithSystemVoice(trimmed, lang);
  }
}

export function stopSpeaking(): void {
  cleanupCloudAudio();
  if (isSynthesisSupported()) window.speechSynthesis.cancel();
}

/** Wait until app speech output is idle before opening the microphone. */
export async function waitForSpeechIdle(settleMs = 900): Promise<void> {
  if (activeCloudSpeech) await activeCloudSpeech.catch(() => undefined);
  if (!isSynthesisSupported()) return;
  const startedAt = Date.now();
  while (
    (window.speechSynthesis.speaking || window.speechSynthesis.pending) &&
    Date.now() - startedAt < 45000
  ) {
    await delay(100);
  }
  await delay(settleMs);
}

export interface ListenResult {
  transcript: string;
  confidence: number;
}

/**
 * Listen for a single utterance. Rejects if recognition is unsupported or
 * errors; callers should fall back to manual input.
 */
export function listenOnce(lang = "en-US"): Promise<ListenResult> {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    return Promise.reject(
      new Error("Speech recognition is not supported in this webview"),
    );
  }
  return new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let settled = false;
    recognition.onresult = (event) => {
      settled = true;
      const alt = event.results[0]?.[0];
      if (alt) {
        resolve({ transcript: alt.transcript, confidence: alt.confidence });
      } else {
        reject(new Error("No speech detected"));
      }
    };
    recognition.onerror = (event) => {
      settled = true;
      reject(new Error(`Speech recognition error: ${event.error}`));
    };
    recognition.onend = () => {
      if (!settled) reject(new Error("No speech detected"));
    };
    recognition.start();
  });
}

/** Map a free-form spoken answer to yes/no, or undefined if unclear. */
export function interpretYesNo(transcript: string): boolean | undefined {
  const t = transcript.trim().toLowerCase();
  // Check negatives first: phrases like "I do not" also contain the
  // affirmative substring "i do", so the negative must win.
  if (
    /\b(no|nope|nah|i don't|i do not|i haven't|i can't|i cannot|false|never)\b/.test(
      t,
    )
  ) {
    return false;
  }
  if (/\b(yes|yeah|yep|correct|i do|i have|i can|true)\b/.test(t)) {
    return true;
  }
  return undefined;
}

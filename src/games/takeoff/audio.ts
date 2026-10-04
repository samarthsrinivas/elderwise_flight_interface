// Microphone capture and voice analysis for the "Take off" sustained-vowel task.
// Everything here runs on the device. Research measures, not a medical result.

export const HOP = 1024; // samples per analysis step (about 21 ms at 48 kHz)

export type AudioPath = "audioworklet" | "scriptprocessor";

export interface AttemptResult {
  attempt: number;
  savedAt: string;
  phonationTimeSec: number;
  totalVoicedSec: number;
  voicedStartSec: number | null;
  voicedEndSec: number | null;
  meanF0Hz: number | null;
  f0SdSemitones: number | null;
  loudnessSdDb: number | null;
  noiseFloorDbfs: number;
  clippedFraction: number;
  sampleRate: number;
  audioPath: AudioPath;
  appliedSettings: Record<string, unknown>;
  qualityFlags: string[];
}

export interface MicHandle {
  ctx: AudioContext;
  stream: MediaStream;
  node: AudioNode;
  path: AudioPath;
  settings: Record<string, unknown>;
}

/* ---------- small maths helpers ---------- */

export function rmsDb(b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s += b[i] * b[i];
  return 20 * Math.log10(Math.sqrt(s / b.length) + 1e-12);
}

/** YIN pitch estimate (de Cheveigné & Kawahara, 2002). Returns Hz, or null when unvoiced. */
export function yin(buf: Float32Array, sr: number, fmin = 60, fmax = 500, thr = 0.2): number | null {
  const maxLag = Math.floor(sr / fmin);
  const minLag = Math.max(2, Math.floor(sr / fmax));
  const W = buf.length - maxLag;
  if (W < 128) return null;
  const d = new Float32Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  const c = new Float32Array(maxLag + 2);
  c[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    run += d[tau];
    c[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (c[t] < thr) {
      while (t + 1 <= maxLag && c[t + 1] < c[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  const a = c[tau - 1], b = c[tau], g = c[tau + 1], den = a - 2 * b + g;
  return sr / (tau + (den !== 0 ? (0.5 * (a - g)) / den : 0));
}

export const median = (xs: number[]): number => {
  const s = [...xs].sort((p, q) => p - q), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (xs: number[], q: number): number => {
  const s = [...xs].sort((p, r) => p - r);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
export const sd = (xs: number[]): number => {
  const m = xs.reduce((p, q) => p + q, 0) / xs.length;
  return Math.sqrt(xs.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const round = (x: number, n: number) => Math.round(x * 10 ** n) / 10 ** n;
const roundOrNull = (x: number | null, n: number) => (x === null ? null : round(x, n));

/* ---------- microphone ---------- */

// The worklet only copies samples, on the audio thread, so drawing the game can
// never delay or drop them. Older webviews fall back to ScriptProcessorNode.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.hop = ${HOP}; this.buf = new Float32Array(this.hop); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.hop) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(this.hop);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("ew-tap", Tap);`;

export async function openMic(onBlock: (block: Float32Array) => void): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    video: false,
  });
  const ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const mute = ctx.createGain();
  mute.gain.value = 0;

  let node: AudioNode;
  let path: AudioPath;
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const w = new AudioWorkletNode(ctx, "ew-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    w.port.onmessage = (e: MessageEvent<Float32Array>) => onBlock(e.data);
    node = w;
    path = "audioworklet";
  } catch {
    const sp = ctx.createScriptProcessor(HOP, 1, 1);
    sp.onaudioprocess = (ev) => onBlock(new Float32Array(ev.inputBuffer.getChannelData(0)));
    node = sp;
    path = "scriptprocessor";
  }
  src.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  const settings = { ...stream.getAudioTracks()[0].getSettings() } as Record<string, unknown>;
  return { ctx, stream, node, path, settings };
}

export function closeMic(m: MicHandle | null) {
  if (!m) return;
  try {
    if (m.node instanceof AudioWorkletNode) m.node.port.onmessage = null;
    if (m.node instanceof ScriptProcessorNode) m.node.onaudioprocess = null;
    m.node.disconnect();
  } catch {
    /* already closed */
  }
  m.stream.getTracks().forEach((t) => t.stop());
  m.ctx.close().catch(() => {});
}

/* ---------- one attempt ---------- */

export interface SessionOptions {
  sampleRate: number;
  maxSeconds: number;
  endSilenceSec?: number; // stop after this much silence once the vowel has started
  noVoiceSec?: number; // stop if no voice is heard within this time
  onEnd: () => void;
}

export class VoiceSession {
  readonly sr: number;
  stage: "idle" | "quiet" | "flying" = "idle";
  level = -90;
  noiseFloor = -90;
  threshold = -50;
  voicedNow = false;
  first: number | null = null;
  last: number | null = null;

  private opts: Required<SessionOptions>;
  private t = 0;
  private noise: number[] = [];
  private quietTalk = 0;
  private miss = 0;
  private f0s: number[] = [];
  private dbs: number[] = [];
  private recent: number[] = [];
  private clipped = 0;
  private total = 0;
  private chunks: Float32Array[] = [];
  private win = new Float32Array(HOP * 2); // sliding window of the last two blocks
  private dec = new Float32Array(HOP); // same window at half the sample rate

  constructor(opts: SessionOptions) {
    this.opts = { endSilenceSec: 0.6, noVoiceSec: 6, ...opts };
    this.sr = opts.sampleRate;
  }

  startQuiet() {
    this.noise = [];
    this.quietTalk = 0;
    this.stage = "quiet";
  }

  /** True if someone was already speaking during the room check. */
  quietWasTalky() {
    return this.quietTalk > this.noise.length * 0.3;
  }

  setThresholdFromRoom() {
    this.noiseFloor = this.noise.length ? percentile(this.noise, 0.3) : -90;
    this.threshold = Math.min(-42, Math.max(this.noiseFloor + 10, -58));
  }

  startFlying() {
    this.stage = "flying";
  }

  stop() {
    this.stage = "idle";
    this.voicedNow = false;
  }

  /** Seconds of steady "aaah" so far, capped at the target. */
  get held(): number {
    return this.first !== null && this.last !== null ? Math.min(this.opts.maxSeconds, this.last - this.first) : 0;
  }

  /** Recent pitch unsteadiness in semitones (used for the gentle wing rock). */
  get wobble(): number {
    return this.recent.length >= 4 ? sd(this.recent) : 0;
  }

  private decimate() {
    for (let i = 0; i < HOP; i++) this.dec[i] = 0.5 * (this.win[2 * i] + this.win[2 * i + 1]);
  }

  push(block: Float32Array) {
    this.win.copyWithin(0, HOP);
    this.win.set(block, HOP);
    const db = rmsDb(block);
    this.level = db;

    if (this.stage === "quiet") {
      this.noise.push(db);
      this.decimate();
      if (db > -50 && yin(this.dec, this.sr / 2) !== null) this.quietTalk++;
      return;
    }
    if (this.stage !== "flying") return;

    this.chunks.push(new Float32Array(block));
    for (let i = 0; i < block.length; i++) if (Math.abs(block[i]) >= 0.99) this.clipped++;
    this.total += block.length;
    const dt = block.length / this.sr;
    this.t += dt;

    let f0: number | null = null;
    if (db > this.threshold - 6) {
      this.decimate();
      f0 = yin(this.dec, this.sr / 2);
    }
    const strong = f0 !== null && db > this.threshold;
    // hysteresis: a wobble of up to about 70 ms does not count as stopping
    this.miss = strong ? 0 : this.miss + 1;
    this.voicedNow = strong || (this.voicedNow && this.miss <= 3 && db > this.threshold - 6);
    if (strong && f0 !== null) {
      if (this.first === null) this.first = this.t - dt;
      this.f0s.push(f0);
      this.dbs.push(db);
      this.recent.push(12 * Math.log2(f0));
      if (this.recent.length > 12) this.recent.shift();
    }
    if (this.voicedNow && this.first !== null) this.last = this.t;

    const { endSilenceSec, noVoiceSec, maxSeconds } = this.opts;
    const done =
      this.first === null
        ? this.t > noVoiceSec
        : this.t - (this.last ?? 0) > endSilenceSec || (this.last ?? 0) - this.first >= maxSeconds;
    if (done) {
      this.stop();
      this.opts.onEnd();
    }
  }

  summarize(attempt: number, settings: Record<string, unknown>, audioPath: AudioPath, savedAt: string): AttemptResult {
    const phon = this.first !== null && this.last !== null ? this.last - this.first : 0;
    // drop octave jumps (> 5 semitones from the median) before measuring steadiness
    const med = this.f0s.length ? median(this.f0s) : 0;
    const keep: number[] = [];
    const keepDb: number[] = [];
    this.f0s.forEach((f, i) => {
      if (Math.abs(12 * Math.log2(f / med)) <= 5) {
        keep.push(f);
        keepDb.push(this.dbs[i]);
      }
    });
    let meanF0: number | null = null;
    let f0Sd: number | null = null;
    if (keep.length >= 4) {
      const lm = keep.reduce((p, f) => p + Math.log2(f), 0) / keep.length;
      meanF0 = 2 ** lm;
      f0Sd = sd(keep.map((f) => 12 * (Math.log2(f) - lm)));
    }
    const voiced = (this.f0s.length * HOP) / this.sr;
    const clip = this.total ? this.clipped / this.total : 0;

    const flags: string[] = [];
    if (this.first === null) flags.push("no_voice_detected");
    else if (voiced < 2) flags.push("under_2s_voiced");
    if (this.noiseFloor > -45) flags.push("noisy_room");
    if (clip > 0.001) flags.push("clipping");
    if (this.f0s.length - keep.length > this.f0s.length * 0.2) flags.push("unstable_pitch_tracking");
    if (settings.echoCancellation === true || settings.noiseSuppression === true || settings.autoGainControl === true)
      flags.push("audio_processing_on");

    return {
      attempt,
      savedAt,
      phonationTimeSec: round(phon, 2),
      totalVoicedSec: round(voiced, 2),
      voicedStartSec: roundOrNull(this.first, 3),
      voicedEndSec: roundOrNull(this.last, 3),
      meanF0Hz: roundOrNull(meanF0, 1),
      f0SdSemitones: roundOrNull(f0Sd, 2),
      loudnessSdDb: keepDb.length >= 4 ? round(sd(keepDb), 2) : null,
      noiseFloorDbfs: round(this.noiseFloor, 1),
      clippedFraction: round(clip, 5),
      sampleRate: this.sr,
      audioPath,
      appliedSettings: settings,
      qualityFlags: flags,
    };
  }

  /** The recording as a 16-bit mono WAV file. */
  wav(): Uint8Array {
    const n = this.chunks.reduce((a, c) => a + c.length, 0);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE");
    w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, this.sr, true); v.setUint32(28, this.sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, n * 2, true);
    let o = 44;
    for (const c of this.chunks) {
      for (let i = 0; i < c.length; i++) {
        const s = Math.max(-1, Math.min(1, c[i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return new Uint8Array(buf);
  }
}

/** Local time as 20261004-153012, used in file names. */
export function timestamp(d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

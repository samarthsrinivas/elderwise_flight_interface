/** Target sample rate for MERaLiON (mono, 16 kHz). */
const TARGET_SAMPLE_RATE = 16000;

export function isMicRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices !== undefined &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    ("AudioContext" in window || "webkitAudioContext" in window)
  );
}

export interface RecordWavClipOptions {
  /** Smoothed RMS level in 0..1, once per animation frame while recording. */
  onAudioLevel?: (level: number) => void;
  /**
   * Latest time-domain window (centered, -1..1) once per animation frame.
   * The same buffer is reused between calls; copy it if you keep history.
   */
  onWaveform?: (samples: Float32Array) => void;
}

/** Analyser window: ~43 ms at 48 kHz, enough to show a few pitch periods. */
const WAVEFORM_FFT_SIZE = 2048;

/** Encode mono float samples as a 16-bit PCM WAV byte array. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Uint8Array(buffer);
}

function audioContextCtor(): typeof AudioContext {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("AudioContext is not supported in this webview");
  return Ctor;
}

/** Downmix to mono and resample to 16 kHz via an OfflineAudioContext. */
async function toMono16k(input: AudioBuffer): Promise<Float32Array> {
  const duration = input.length / input.sampleRate;
  const frames = Math.ceil(duration * TARGET_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = input;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

/**
 * Record a microphone clip and return it as a 16 kHz mono WAV byte array.
 * Rejects if the mic is denied or capture is unsupported (callers fall back
 * to tap answers). Stops automatically after `maxMs`.
 */
export async function recordWavClip(
  maxMs: number,
  options: RecordWavClipOptions = {},
): Promise<Uint8Array> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let levelContext: AudioContext | undefined;
  let levelFrame = 0;
  try {
    if (options.onAudioLevel || options.onWaveform) {
      levelContext = new (audioContextCtor())();
      // On iOS a freshly constructed AudioContext starts SUSPENDED and never
      // renders until resumed, where the macOS webview this was built against
      // starts running. Without this the analyser reads a flat 128 for the
      // whole clip and the level meter shows silence while the participant is
      // speaking - which reads as "it isn't hearing me" and makes them stop.
      // Best effort: resume() can reject when no user gesture is in scope
      // (the questionnaire auto-listens after a TTS round trip), and a dead
      // meter is not a reason to fail the recording itself.
      void levelContext.resume().catch(() => undefined);
      const source = levelContext.createMediaStreamSource(stream);
      const analyser = levelContext.createAnalyser();
      analyser.fftSize = options.onWaveform ? WAVEFORM_FFT_SIZE : 512;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const waveform = new Float32Array(analyser.fftSize);
      const updateLevel = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const centered = ((samples[i] ?? 128) - 128) / 128;
          waveform[i] = centered;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / samples.length);
        options.onAudioLevel?.(Math.min(1, rms * 8));
        options.onWaveform?.(waveform);
        levelFrame = window.requestAnimationFrame(updateLevel);
      };
      updateLevel();
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    const timer = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, maxMs);
    await stopped;
    clearTimeout(timer);

    const blob = new Blob(chunks, { type: chunks[0]?.type ?? "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new (audioContextCtor())();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      const mono16k = await toMono16k(decoded);
      return encodeWav(mono16k, TARGET_SAMPLE_RATE);
    } finally {
      void ctx.close();
    }
  } finally {
    if (levelFrame) window.cancelAnimationFrame(levelFrame);
    options.onAudioLevel?.(0);
    if (levelContext) void levelContext.close();
    for (const track of stream.getTracks()) track.stop();
  }
}

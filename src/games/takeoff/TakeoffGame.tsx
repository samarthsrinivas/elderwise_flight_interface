// "Take off": the sustained-vowel ("aaah") task as a game.
// The person's voice powers a plane down the runway (take-off at 1/3 of the target time),
// through the clouds (2/3) and up to cruising height (the full target).

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { closeMic, openMic, timestamp, VoiceSession } from "./audio";
import type { AttemptResult, MicHandle } from "./audio";
import { createScene } from "./scene";
import type { SceneStage } from "./scene";

type Phase = "intro" | "prompt" | "quiet" | "countdown" | "flying" | "done" | "error";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; wavPath: string; folder: string }
  | { status: "failed"; message: string };

interface SaveReply {
  wavPath: string;
  folder: string;
}

interface Props {
  /** Seconds of "aaah" needed to reach cruising height. */
  maxSeconds?: number;
  /** Called after every attempt, for example to store results elsewhere in the app. */
  onAttempt?: (result: AttemptResult) => void;
}

const QUIET_SEC = 1.5;
const PROMPT_SPOKEN =
  "Take a deep breath. After the countdown, say aah, steady and comfortable, for as long as you can.";
const PROMPT_SHOWN =
  "Take a deep breath. After the countdown, say “aaah”, steady and comfortable, for as long as you can.";
const INTRO =
  "Take a deep breath, then say “aaah” for as long as you comfortably can. Your voice powers the plane down the runway and up into the sky.";

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Pack the result JSON and the WAV into one binary message for the Rust side:
 *  [4-byte little-endian JSON length][JSON][WAV]. */
function packUpload(result: AttemptResult, wav: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(result));
  const out = new Uint8Array(4 + json.length + wav.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(wav, 4 + json.length);
  return out;
}

const stageFor = (p: Phase): SceneStage =>
  p === "flying" ? "flying" : p === "done" ? "done" : p === "intro" || p === "error" ? "intro" : "waiting";

export default function TakeoffGame({ maxSeconds = 15, onAttempt }: Props) {
  const lift = maxSeconds / 3;

  const [phase, setPhase] = useState<Phase>("intro");
  const [title, setTitle] = useState("Take off");
  const [sub, setSub] = useState(INTRO);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const phaseRef = useRef<Phase>("intro");
  const sessionRef = useRef<VoiceSession | null>(null);
  const micRef = useRef<MicHandle | null>(null);
  const runId = useRef(0);
  const attemptRef = useRef(0);
  const cheerRef = useRef("");
  const finishRef = useRef<() => void>(() => {});

  // elements updated every frame without re-rendering React
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const earRef = useRef<HTMLSpanElement>(null);
  const levelRef = useRef<HTMLDivElement>(null);
  const knotsRef = useRef<HTMLElement>(null);
  const feetRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);
  const stopRefs = useRef<(HTMLElement | null)[]>([]);
  const dotRefs = useRef<(HTMLElement | null)[]>([]);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const say = (t: string, s: string) => {
    setTitle(t);
    setSub(s);
  };

  const later = (ms: number, id: number, fn: () => void) =>
    window.setTimeout(() => {
      if (runId.current === id) fn();
    }, ms);

  const speak = (text: string, id: number, done: () => void) => {
    let called = false;
    const fin = () => {
      if (!called && runId.current === id) {
        called = true;
        done();
      }
    };
    const synth = window.speechSynthesis;
    if (!synth) {
      later(2500, id, fin);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.88;
    u.onend = fin;
    u.onerror = fin;
    synth.speak(u);
    later(15000, id, fin); // in case the voice never reports that it finished
  };

  const stopMic = useCallback(() => {
    closeMic(micRef.current);
    micRef.current = null;
  }, []);

  const finish = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || phaseRef.current !== "flying") return;
    const mic = micRef.current;
    session.stop();
    go("done");
    stopMic();

    const res = session.summarize(attemptRef.current, mic?.settings ?? {}, mic?.path ?? "audioworklet", timestamp());
    const held = res.phonationTimeSec;
    if (res.qualityFlags.includes("no_voice_detected")) {
      say("We didn’t hear the “aaah”", "Move a little closer to the microphone and try again.");
    } else {
      say(
        `You flew for ${held.toFixed(1)} seconds`,
        held >= maxSeconds ? "You reached cruising height. Wonderful."
          : held >= lift * 2 ? "You climbed above the clouds. Well done."
          : held >= lift ? "Wheels up. You took off."
          : "The plane rolled down the runway. Try once more if you like.",
      );
    }
    setResult(res);
    onAttempt?.(res);

    const wav = session.wav();
    setWavUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }));
    });

    if (!inTauri()) {
      setSave({ status: "failed", message: "Running in a normal browser, so the recording was not saved. Use npm run tauri dev." });
      return;
    }
    setSave({ status: "saving" });
    try {
      const reply = await invoke<SaveReply>("save_attempt", packUpload(res, wav));
      setSave({ status: "saved", wavPath: reply.wavPath, folder: reply.folder });
    } catch (e) {
      setSave({ status: "failed", message: String(e) });
    }
  }, [lift, maxSeconds, onAttempt, stopMic]);
  finishRef.current = () => void finish();

  const listenToRoom = (id: number, tries: number) => {
    const session = sessionRef.current;
    if (!session) return;
    session.startQuiet();
    go("quiet");
    say("Stay quiet for a moment", tries ? "Please wait for the countdown before saying “aaah”." : "Listening to the room.");
    later(QUIET_SEC * 1000, id, () => {
      if (session.quietWasTalky() && tries < 2) {
        listenToRoom(id, tries + 1);
        return;
      }
      session.setThresholdFromRoom();
      session.stop();
      go("countdown");
      say("3", "Breathe in.");
      later(1000, id, () => say("2", "Breathe in."));
      later(2000, id, () => say("1", "Breathe in."));
      later(3000, id, () => {
        cheerRef.current = "";
        session.startFlying();
        go("flying");
        say("Say “aaah”", "Say “aaah” now");
      });
    });
  };

  const start = async () => {
    const id = ++runId.current;
    attemptRef.current += 1;
    setResult(null);
    setSave({ status: "idle" });
    setShowDetails(false);
    stopMic();
    try {
      const mic = await openMic((block) => sessionRef.current?.push(block));
      micRef.current = mic;
      sessionRef.current = new VoiceSession({
        sampleRate: mic.ctx.sampleRate,
        maxSeconds,
        onEnd: () => finishRef.current(),
      });
    } catch {
      go("error");
      say(
        "Microphone not available",
        "Check that a microphone is connected and that this app is allowed to use it, close other apps using the microphone, then press Try again.",
      );
      return;
    }
    go("prompt");
    say("Listen", PROMPT_SHOWN);
    speak(PROMPT_SPOKEN, id, () => listenToRoom(id, 0));
  };

  // animation loop: draws the scene and updates the instruments
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const draw = createScene(maxSeconds, reduce);
    let raf = 0;
    const loop = (ts: number) => {
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const p = phaseRef.current;
        const session = sessionRef.current;
        const held = session && p !== "intro" ? session.held : 0;
        const voiced = p === "flying" && !!session?.voicedNow;
        const out = draw(ctx, w, h, ts, { stage: stageFor(p), held, voiced, wobble: session?.wobble ?? 0 });

        if (knotsRef.current) knotsRef.current.textContent = String(out.knots);
        if (feetRef.current) feetRef.current.textContent = out.feet.toLocaleString("en-US");
        const pct = `${(out.progress * 100).toFixed(2)}%`;
        if (fillRef.current) fillRef.current.style.width = pct;
        if (iconRef.current) iconRef.current.style.left = pct;
        stopRefs.current.forEach((el, i) => el?.classList.toggle("on", i === 0 || held >= lift * i));
        dotRefs.current.forEach((el, i) => el?.classList.toggle("on", i === 0 || held >= lift * i));
        earRef.current?.classList.toggle("on", voiced);
        if (levelRef.current) {
          const lv = session && micRef.current ? Math.max(0, Math.min(1, (session.level - (session.threshold - 12)) / 36)) : 0;
          levelRef.current.style.width = `${(lv * 100).toFixed(0)}%`;
          levelRef.current.classList.toggle("on", voiced);
        }
        if (p === "flying" && voiced && session?.first !== null) {
          const msg = held >= maxSeconds - 2 ? "Almost at cruising height"
            : held >= lift * 2 ? "Above the clouds. Lovely and steady"
            : held >= lift ? "Wheels up. Keep going"
            : "Speeding down the runway";
          if (msg !== cheerRef.current) {
            cheerRef.current = msg;
            setSub(msg);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [maxSeconds, lift]);

  // tidy up when the screen closes
  useEffect(
    () => () => {
      runId.current++;
      window.speechSynthesis?.cancel();
      stopMic();
    },
    [stopMic],
  );

  const openFolder = async () => {
    try {
      await invoke("open_sessions_folder");
    } catch (e) {
      setSave({ status: "failed", message: String(e) });
    }
  };

  const stops = [
    { label: "Runway", at: 0 },
    { label: "Take-off", at: 1 / 3 },
    { label: "Above the clouds", at: 2 / 3 },
    { label: "Cruising", at: 1 },
  ];
  const v = (x: number | null | undefined, unit: string) => (x === null || x === undefined ? "–" : `${x}${unit}`);

  return (
    <div className="tk">
      <h1 className="tk-title">{title}</h1>
      <p className="tk-sub" aria-live="polite">
        <span ref={earRef} className={`tk-ear${phase === "flying" ? " show" : ""}`} aria-hidden="true" />
        <span>{sub}</span>
      </p>

      <div className="tk-stage">
        <canvas ref={canvasRef} className="tk-canvas" aria-label="A passenger plane on a runway at sunrise, taking off into the sky" />
        <div className="tk-hud">
          <div className="tk-gauge"><span>Speed</span><b ref={knotsRef}>0</b><i>knots</i></div>
          <div className="tk-gauge"><span>Altitude</span><b ref={feetRef}>0</b><i>feet</i></div>
          <div className="tk-gauge tk-voice"><span>Your voice</span><div className="tk-meter"><div ref={levelRef} /></div></div>
        </div>
      </div>

      <div className="tk-track" aria-hidden="true">
        <div className="tk-line"><div ref={fillRef} className="tk-fill" /></div>
        {stops.map((s, i) => (
          <span
            key={`d${i}`}
            ref={(el: HTMLSpanElement | null) => { dotRefs.current[i] = el; }}
            className={`tk-dot${i === 0 ? " on" : ""}`}
            style={{ left: `${s.at * 100}%` }}
          />
        ))}
        {stops.map((s, i) => (
          <span
            key={s.label}
            ref={(el: HTMLSpanElement | null) => { stopRefs.current[i] = el; }}
            className={`tk-label${i === 0 ? " first on" : i === stops.length - 1 ? " last" : ""}`}
            style={{ left: `${s.at * 100}%` }}
          >
            {s.label}
          </span>
        ))}
        <svg ref={iconRef} className="tk-icon" viewBox="0 0 24 24">
          <path fill="currentColor" d="M22 12c0-.8-.7-1.5-1.5-1.5H15L10 3H8l2.5 7.5H5L3 8H1.5l1.2 4-1.2 4H3l2-2.5h5.5L8 21h2l5-7.5h5.5c.8 0 1.5-.7 1.5-1.5z" />
        </svg>
      </div>

      <div className="tk-bottom">
        {(phase === "intro" || phase === "error") && (
          <button className="tk-btn" onClick={start}>{phase === "error" ? "Try again" : "Start"}</button>
        )}
        {phase === "flying" && (
          <button className="tk-btn quiet" onClick={() => finishRef.current()}>Stop</button>
        )}
        {phase === "done" && (
          <>
            <button className="tk-btn" onClick={start}>Try again</button>
            <button className="tk-link" onClick={() => setShowDetails((s) => !s)}>
              {showDetails ? "Hide details" : "Details for the caregiver"}
            </button>
          </>
        )}
      </div>

      {phase === "done" && result && showDetails && (
        <section className="tk-details">
          <p>Research measures for tracking change over time. Not a medical result.</p>
          <dl>
            <dt>Attempt</dt><dd>{result.attempt}</dd>
            <dt>Phonation time</dt><dd>{v(result.phonationTimeSec, " s")}</dd>
            <dt>Mean pitch</dt><dd>{v(result.meanF0Hz, " Hz")}</dd>
            <dt>Pitch steadiness (SD)</dt><dd>{v(result.f0SdSemitones, " semitones")}</dd>
            <dt>Loudness steadiness (SD)</dt><dd>{v(result.loudnessSdDb, " dB")}</dd>
            <dt>Room noise</dt><dd>{v(result.noiseFloorDbfs, " dBFS")}</dd>
            <dt>Quality flags</dt><dd>{result.qualityFlags.length ? result.qualityFlags.join(", ") : "none"}</dd>
            <dt>Recording</dt>
            <dd>
              {save.status === "saving" && "Saving…"}
              {save.status === "saved" && save.wavPath}
              {save.status === "failed" && `Not saved: ${save.message}`}
            </dd>
          </dl>
          {wavUrl && <audio controls src={wavUrl} />}
          {save.status === "saved" && (
            <button className="tk-link" onClick={openFolder}>Open recordings folder</button>
          )}
        </section>
      )}
    </div>
  );
}

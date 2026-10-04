/**
 * Shared loader for the on-device MediaPipe Face Landmarker.
 *
 * Both the vitals (rPPG face ROI) and eye-movement (iris landmarks) modules
 * consume the same detector, so it is created once and reused. Everything
 * runs inside the webview: the WASM runtime and the `.task` model are served
 * from `public/` after `bun run models:fetch`. No frames leave the device.
 *
 * Landmark indices worth knowing (478-point mesh with iris refinement):
 * - 468..472 right iris (468 = centre), 473..477 left iris (473 = centre)
 * - 33 / 133 right eye outer/inner corners, 362 / 263 left eye inner/outer
 * - 159 / 145 right eye upper/lower lid, 386 / 374 left eye upper/lower lid
 * - 10 forehead top, 151 forehead centre, 1 nose tip, 152 chin
 */
import type { FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";

export const MEDIAPIPE_WASM_PATH = "/mediapipe/wasm";
export const FACE_LANDMARKER_MODEL_PATH = "/models/face_landmarker.task";

export type { NormalizedLandmark };

export interface FaceLandmarkFrame {
  /** 478 normalised landmarks (x, y in 0..1 of the video frame). */
  readonly landmarks: readonly NormalizedLandmark[];
  /** Blendshape scores keyed by category name, e.g. `eyeBlinkLeft`. */
  readonly blendshapes: ReadonlyMap<string, number>;
  readonly timestampMs: number;
}

export interface FaceLandmarkDetector {
  /** Returns null when no face is in frame. */
  detect(video: HTMLVideoElement, timestampMs: number): FaceLandmarkFrame | null;
  close(): void;
}

export class FaceLandmarkerUnavailableError extends Error {
  constructor(cause: string) {
    super(`Face landmarker unavailable: ${cause}`);
    this.name = "FaceLandmarkerUnavailableError";
  }
}

let shared: Promise<FaceLandmarker> | null = null;

async function createLandmarker(): Promise<FaceLandmarker> {
  const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_PATH, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
}

/**
 * Lazily creates the shared landmarker. Throws
 * `FaceLandmarkerUnavailableError` when assets are missing or WASM fails to
 * initialise; callers must degrade gracefully (e.g. mark the step
 * unavailable) rather than crash the flow.
 */
export async function loadFaceLandmarkDetector(): Promise<FaceLandmarkDetector> {
  if (shared === null) {
    shared = createLandmarker().catch((raised: unknown) => {
      shared = null;
      const message = raised instanceof Error ? raised.message : String(raised);
      throw new FaceLandmarkerUnavailableError(message);
    });
  }
  const landmarker = await shared;
  return {
    detect(video, timestampMs) {
      const result = landmarker.detectForVideo(video, timestampMs);
      const landmarks = result.faceLandmarks[0];
      if (landmarks === undefined) return null;
      const blendshapes = new Map<string, number>();
      for (const category of result.faceBlendshapes[0]?.categories ?? []) {
        blendshapes.set(category.categoryName, category.score);
      }
      return { landmarks, blendshapes, timestampMs };
    },
    close() {
      // Shared instance: closing is a no-op for consumers. Use
      // `disposeFaceLandmarkDetector` at app teardown if ever needed.
    },
  };
}

/** Releases the shared WASM instance. Only for tests/teardown. */
export async function disposeFaceLandmarkDetector(): Promise<void> {
  if (shared === null) return;
  const landmarker = await shared.catch(() => null);
  shared = null;
  landmarker?.close();
}

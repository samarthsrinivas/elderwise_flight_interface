import type { NormalizedLandmark } from "../../lib/faceLandmarker";

export interface Roi {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function insetBox(points: readonly NormalizedLandmark[], width: number, height: number): Roi {
  if (points.length === 0 || ![width, height, ...points.flatMap(point => [point.x, point.y])].every(Number.isFinite)) return { x: 0, y: 0, w: 0, h: 0 };
  const left = Math.min(...points.map(point => point.x)) * width;
  const right = Math.max(...points.map(point => point.x)) * width;
  const top = Math.min(...points.map(point => point.y)) * height;
  const bottom = Math.max(...points.map(point => point.y)) * height;
  return { x: left + (right - left) * 0.05, y: top + (bottom - top) * 0.05, w: (right - left) * 0.9, h: (bottom - top) * 0.9 };
}

export function foreheadRoi(landmarks: readonly NormalizedLandmark[], width: number, height: number): Roi {
  const top = landmarks[10];
  const bottom = landmarks[151];
  const right = landmarks[70];
  const left = landmarks[300];
  if (!top || !bottom || !right || !left) return { x: 0, y: 0, w: 0, h: 0 };
  return insetBox([{ ...top, x: right.x }, { ...bottom, x: left.x }], width, height);
}

export function cheekRois(landmarks: readonly NormalizedLandmark[], width: number, height: number): [Roi, Roi] {
  const patch = (indices: readonly number[]) => {
    const points = indices.flatMap(index => landmarks[index] ? [landmarks[index]] : []);
    return insetBox(points.length === indices.length ? points : [], width, height);
  };
  return [patch([50, 101, 205]), patch([280, 330, 425])];
}

type PixelContext = {
  readonly canvas: Pick<HTMLCanvasElement, "width" | "height">;
  getImageData(x: number, y: number, width: number, height: number): Pick<ImageData, "data">;
};

export function meanRgb(ctx: PixelContext, roi: Roi): { r: number; g: number; b: number } | null {
  if (![roi.x, roi.y, roi.w, roi.h].every(Number.isFinite) || roi.w <= 0 || roi.h <= 0) return null;
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const width = Math.min(ctx.canvas.width, Math.ceil(roi.x + roi.w)) - x;
  const height = Math.min(ctx.canvas.height, Math.ceil(roi.y + roi.h)) - y;
  if (width <= 0 || height <= 0) return null;
  const { data } = ctx.getImageData(x, y, width, height);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let index = 0; index + 2 < data.length; index += 8) {
    r += data[index]; g += data[index + 1]; b += data[index + 2]; count++;
  }
  return count > 0 ? { r: r / count, g: g / count, b: b / count } : null;
}

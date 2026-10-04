import type { RgbSample } from "./rppg";

export function sine(hz: number): Float64Array {
  return Float64Array.from({ length: 900 }, (_, index) => Math.sin(2 * Math.PI * hz * index / 30));
}

export function syntheticRgb(): RgbSample[] {
  let seed = 1234567;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.12;
  };
  return Array.from({ length: 900 }, (_, index) => {
    const seconds = index / 30;
    const pulse = Math.sin(2 * Math.PI * 1.2 * seconds + 0.4 * Math.sin(2 * Math.PI * 0.15 * seconds));
    const drift = Math.sin(2 * Math.PI * 0.25 * seconds);
    return { t: seconds * 1000, r: 140 + 0.3 * pulse + 2 * drift + noise(), g: 110 + 1.5 * pulse + 2 * drift + noise(), b: 80 + 0.15 * pulse + drift + noise() };
  });
}

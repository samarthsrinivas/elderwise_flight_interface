import { describe, expect, it } from "vitest";
import { encodeWav } from "./recordWav";

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[offset + i] ?? 0);
  return s;
}
function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}
function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}
function readI16LE(bytes: Uint8Array, offset: number): number {
  const v = readU16LE(bytes, offset);
  return v & 0x8000 ? v - 0x10000 : v;
}

describe("encodeWav", () => {
  it("writes a valid 16-bit mono PCM WAV header", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWav(samples, 16000);
    expect(readAscii(wav, 0, 4)).toBe("RIFF");
    expect(readAscii(wav, 8, 4)).toBe("WAVE");
    expect(readAscii(wav, 12, 4)).toBe("fmt ");
    expect(readU16LE(wav, 20)).toBe(1); // PCM
    expect(readU16LE(wav, 22)).toBe(1); // mono
    expect(readU32LE(wav, 24)).toBe(16000); // sample rate
    expect(readU16LE(wav, 34)).toBe(16); // bits per sample
    expect(readAscii(wav, 36, 4)).toBe("data");
    // header is 44 bytes + 2 bytes per sample
    expect(wav.length).toBe(44 + samples.length * 2);
    expect(readU32LE(wav, 40)).toBe(samples.length * 2); // data chunk size
  });

  it("clamps and scales float samples to int16", () => {
    const wav = encodeWav(new Float32Array([1, -1, 0]), 16000);
    expect(readI16LE(wav, 44)).toBe(32767); // +1 -> max
    expect(readI16LE(wav, 46)).toBe(-32768); // -1 -> min
    expect(readI16LE(wav, 48)).toBe(0);
  });

  it("clamps out-of-range values", () => {
    const wav = encodeWav(new Float32Array([2, -2]), 16000);
    expect(readI16LE(wav, 44)).toBe(32767);
    expect(readI16LE(wav, 46)).toBe(-32768);
  });
});

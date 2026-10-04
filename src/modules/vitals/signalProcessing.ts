export interface RgbSample {
  readonly t: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function cleanSamples(samples: readonly RgbSample[]): RgbSample[] {
  return samples.filter(sample => Number.isFinite(sample.t)
    && [sample.r, sample.g, sample.b].every(value => Number.isFinite(value) && value >= 0 && value <= 255))
    .sort((left, right) => left.t - right.t)
    .filter((sample, index, sorted) => index === 0 || sample.t > sorted[index - 1].t);
}

export function resampleUniform(samples: readonly RgbSample[], fs: number): RgbSample[] {
  const sorted = cleanSamples(samples);
  if (sorted.length < 2 || !Number.isFinite(fs) || fs <= 0) return [];
  const start = sorted[0].t;
  const count = Math.floor((sorted[sorted.length - 1].t - start) * fs / 1000 + 1e-8) + 1;
  if (!Number.isFinite(count) || count > 18000) return [];
  let cursor = 0;
  return Array.from({ length: count }, (_, index) => {
    const t = start + index * 1000 / fs;
    while (cursor < sorted.length - 2 && sorted[cursor + 1].t < t) cursor++;
    const left = sorted[cursor];
    const right = sorted[cursor + 1];
    const fraction = (t - left.t) / (right.t - left.t);
    return { t, r: left.r + fraction * (right.r - left.r), g: left.g + fraction * (right.g - left.g), b: left.b + fraction * (right.b - left.b) };
  });
}

// Wang et al. (2017), POS: temporal RGB normalization, plane projection,
// variance balancing and mean-centered overlap-add over 1.6 second windows.
export function posSignal(samples: readonly RgbSample[], fs: number, windowS = 1.6): Float64Array {
  const output = new Float64Array(samples.length);
  const counts = new Float64Array(samples.length);
  const size = Math.min(samples.length, Math.round(fs * windowS));
  if (!Number.isFinite(size) || size < 2) return output;
  for (let start = 0; start <= samples.length - size; start++) {
    const window = samples.slice(start, start + size);
    const means = window.reduce((sum, sample) => [sum[0] + sample.r / size, sum[1] + sample.g / size, sum[2] + sample.b / size], [0, 0, 0]);
    if (means.some(value => !Number.isFinite(value) || value <= 0)) continue;
    const first = window.map(sample => sample.g / means[1] - sample.b / means[2]);
    const second = window.map(sample => sample.g / means[1] + sample.b / means[2] - 2 * sample.r / means[0]);
    const energy = (values: readonly number[]) => values.reduce((sum, value) => sum + value * value, 0);
    const denominator = energy(second);
    const alpha = denominator > 1e-20 ? Math.sqrt(energy(first) / denominator) : 0;
    const pulse = first.map((value, index) => value + alpha * second[index]);
    const mean = pulse.reduce((sum, value) => sum + value / size, 0);
    pulse.forEach((value, index) => { output[start + index] += value - mean; counts[start + index]++; });
  }
  return output.map((value, index) => counts[index] > 0 ? value / counts[index] : 0);
}

export function detrend(x: Float64Array, windowSamples: number): Float64Array {
  const radius = Number.isFinite(windowSamples) ? Math.max(0, Math.floor(windowSamples / 2)) : 0;
  const prefix = new Float64Array(x.length + 1);
  x.forEach((value, index) => { prefix[index + 1] = prefix[index] + value; });
  return x.map((value, index) => {
    const left = Math.max(0, index - radius);
    const right = Math.min(x.length, index + radius + 1);
    return value - (prefix[right] - prefix[left]) / (right - left);
  });
}

type Biquad = readonly [number, number, number, number, number];

function filter(input: Float64Array, coefficients: Biquad): Float64Array {
  const [b0, b1, b2, a1, a2] = coefficients;
  let previousInput = input[0];
  let secondInput = previousInput;
  let previousOutput = previousInput * (b0 + b1 + b2) / (1 + a1 + a2);
  let secondOutput = previousOutput;
  return input.map(value => {
    const output = b0 * value + b1 * previousInput + b2 * secondInput - a1 * previousOutput - a2 * secondOutput;
    secondInput = previousInput; previousInput = value;
    secondOutput = previousOutput; previousOutput = output;
    return output;
  });
}

// Bilinear-transform Butterworth biquads (Q = 1/sqrt(2)); reflected padding
// reduces startup transients, and forward/backward cascades cancel phase delay.
export function bandpass(x: Float64Array, fs: number, lowHz: number, highHz: number): Float64Array {
  if (x.length < 3 || ![fs, lowHz, highHz].every(Number.isFinite) || lowHz <= 0 || highHz <= lowHz || highHz >= fs / 2) return new Float64Array(x.length);
  const coefficients = (hz: number, highpass: boolean): Biquad => {
    const cosine = Math.cos(2 * Math.PI * hz / fs);
    const alpha = Math.sin(2 * Math.PI * hz / fs) / Math.SQRT2;
    const scale = 1 + alpha;
    const numerator = highpass ? 1 + cosine : 1 - cosine;
    return [numerator / (2 * scale), (highpass ? -numerator : numerator) / scale, numerator / (2 * scale), -2 * cosine / scale, (1 - alpha) / scale];
  };
  const padding = Math.min(x.length - 1, Math.ceil(3 * fs / lowHz));
  const extended = new Float64Array(x.length + 2 * padding);
  extended.set(x, padding);
  for (let index = 0; index < padding; index++) {
    extended[padding - index - 1] = 2 * x[0] - x[index + 1];
    extended[padding + x.length + index] = 2 * x[x.length - 1] - x[x.length - index - 2];
  }
  const high = coefficients(lowHz, true);
  const low = coefficients(highHz, false);
  const forward = filter(filter(extended, high), low).reverse();
  return filter(filter(forward, low), high).reverse().slice(padding, padding + x.length);
}

export function powerSpectrum(x: Float64Array, fs: number, lowHz: number, highHz: number, binHz = 0.01): { freqs: Float64Array; power: Float64Array } {
  const empty = { freqs: new Float64Array(), power: new Float64Array() };
  if (x.length < 3 || ![fs, lowHz, highHz, binHz].every(Number.isFinite) || fs <= 0 || lowHz < 0 || highHz < lowHz || binHz <= 0) return empty;
  const count = Math.floor((Math.min(highHz, fs / 2) - lowHz) / binHz + 1e-8) + 1;
  if (count < 1 || count > 10000) return empty;
  const mean = x.reduce((sum, value) => sum + value / x.length, 0);
  const window = x.map((value, index) => (value - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (x.length - 1))));
  const freqs = Float64Array.from({ length: count }, (_, index) => lowHz + index * binHz);
  const power = freqs.map(hz => {
    let real = 0;
    let imaginary = 0;
    window.forEach((value, index) => {
      const angle = 2 * Math.PI * hz * index / fs;
      real += value * Math.cos(angle);
      imaginary += value * Math.sin(angle);
    });
    return (real * real + imaginary * imaginary) / (x.length * x.length);
  });
  return { freqs, power };
}

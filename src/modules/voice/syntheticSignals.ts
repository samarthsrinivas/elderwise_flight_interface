export const SAMPLE_RATE = 16000;

export function sine(durationS = 2, frequencyHz = 150): Float32Array {
  return Float32Array.from({ length: Math.round(durationS * SAMPLE_RATE) },
    (_, index) => 0.5 * Math.sin(2 * Math.PI * frequencyHz * index / SAMPLE_RATE));
}

export function perturbedSine(options: {
  readonly periodVariation?: number;
  readonly amplitudeVariation?: number;
  readonly noiseSnrDb?: number;
}): Float32Array {
  let seed = 12345;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const samples = new Float32Array(2 * SAMPLE_RATE);
  let phase = 0;
  let period = SAMPLE_RATE / 150;
  let amplitude = 0.5;
  const noiseAmplitude = options.noiseSnrDb === undefined
    ? 0 : Math.sqrt(3 * 0.125 / 10 ** (options.noiseSnrDb / 10));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin(2 * Math.PI * phase) + noiseAmplitude * (2 * random() - 1);
    phase += 1 / period;
    if (phase >= 1) {
      phase -= 1;
      period = SAMPLE_RATE / 150 * (1 + (options.periodVariation ?? 0) * (random() < 0.5 ? -1 : 1));
      amplitude = 0.5 * (1 + (options.amplitudeVariation ?? 0) * (random() < 0.5 ? -1 : 1));
    }
  }
  return samples;
}

export function speechBursts(): Float32Array {
  const samples = new Float32Array(4 * SAMPLE_RATE);
  for (let burst = 0; burst < 10; burst += 1) {
    const start = Math.round((0.25 + burst * 0.3 + (burst >= 6 ? 0.25 : 0)) * SAMPLE_RATE);
    for (let offset = 0; offset < 0.15 * SAMPLE_RATE; offset += 1) {
      samples[start + offset] = 0.5 * Math.sin(Math.PI * offset / (0.15 * SAMPLE_RATE))
        * Math.sin(2 * Math.PI * 200 * offset / SAMPLE_RATE);
    }
  }
  return samples;
}

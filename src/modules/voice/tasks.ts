import type { VoiceTaskId } from "../assessment/types";

export interface VoiceTaskSpec {
  readonly id: VoiceTaskId;
  readonly title: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly durationS: number;
}

const TASKS = {
  "sustained-vowel": {
    id: "sustained-vowel",
    title: "Hold a sound",
    instructions: "Take a breath and say 'ahh' in a steady voice for as long as you comfortably can.",
    prompt: "ahh",
    durationS: 6,
  },
  "reading-passage": {
    id: "reading-passage",
    title: "Read a passage",
    instructions: "Read the following passage aloud at your usual, comfortable pace.",
    prompt: "When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. The rainbow is a division of white light into many beautiful colors. These take the shape of a long round arch, with its path high above, and its two ends apparently beyond the horizon. There is, according to legend, a boiling pot of gold at one end. People look, but no one ever finds it. When a man looks for something beyond his reach, his friends say he is looking for the pot of gold at the end of the rainbow.",
    durationS: 40,
  },
  "free-speech": {
    id: "free-speech",
    title: "Tell us about yesterday",
    instructions: "Tell me about what you did yesterday from the time you woke up.",
    prompt: "Tell me about what you did yesterday from the time you woke up.",
    durationS: 30,
  },
} as const satisfies Record<VoiceTaskId, VoiceTaskSpec>;

export const VOICE_TASKS: readonly VoiceTaskSpec[] = [
  TASKS["sustained-vowel"], TASKS["reading-passage"], TASKS["free-speech"],
];

export function voiceTaskSpec(id: VoiceTaskId): VoiceTaskSpec {
  return TASKS[id];
}

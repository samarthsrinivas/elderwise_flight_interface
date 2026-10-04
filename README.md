# ElderWise

Local-first desktop app that runs a short, guided check-in for older adults and
reports aging-related biomarkers from three signals:

- **Voice** — sustained vowel, reading passage and free speech, analysed locally
  (F0, jitter, shimmer, HNR, speech rate, pause ratio).
- **Vitals** — webcam remote photoplethysmography (heart rate, HRV, respiratory
  rate), analysed locally.
- **Eye movement** — fixation, prosaccade and smooth-pursuit tasks tracked with
  on-device face/iris landmarks.

Only two things leave the device: speech audio sent to a transcription/TTS
provider (ElevenLabs or OpenAI) and the de-identified results JSON sent to an
LLM (OpenAI) for a plain-English summary. Everything else runs in the app.

Scaffolded from [pulsewise](https://github.com/ajentik/pulsewise). See the
sections below as they land.

## Status

Scaffolding in progress — see open pull requests.

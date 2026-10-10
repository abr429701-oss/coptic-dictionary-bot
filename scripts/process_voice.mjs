// scripts/process_voice.mjs
//
// Normalise a recorded dictionary voice using the reference recording report.
// The source recording is never overwritten; this writes a processed OGG.
//
// Reference targets:
//   median F0: 183.91 Hz (used only when SOURCE_F0_HZ is supplied)
//   RMS/loudness: about -17 dBFS (slightly louder than the reference)
//   true peak: <= -3.1 dBFS
//   spectral landmarks: 203.12 Hz peak, 334.02 Hz centroid, 375 Hz rolloff
//   speech treatment: aggressive FFT denoise, dry mono signal, gentle compression
//
// Usage:
//   node scripts/process_voice.mjs input.ogg output.ogg
//   SOURCE_F0_HZ=220 node scripts/process_voice.mjs input.ogg output.ogg

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/process_voice.mjs <input> <output>");
  process.exit(2);
}

const TARGET_F0_HZ = 183.91;
const sourceF0 = Number(process.env.SOURCE_F0_HZ ?? TARGET_F0_HZ);
const pitchRatio = Number.isFinite(sourceF0) && sourceF0 > 0
  ? TARGET_F0_HZ / sourceF0
  : 1;

// Keep natural intonation by default. A pitch correction is applied only when
// the operator supplies SOURCE_F0_HZ for the speaker/reference recording.
const pitch = Math.abs(pitchRatio - 1) > 0.005
  ? `rubberband=pitch=${pitchRatio.toFixed(6)}`
  : null;

const filters = [
  pitch,
  // Strong but bounded broadband denoise. It removes stationary room/fan noise;
  // no filter can honestly guarantee zero noise without damaging consonants.
  "afftdn=nr=24:nf=-45:tn=1",
  "highpass=f=75",
  "lowpass=f=11500",
  "deesser=i=0.2:m=0.5:f=0.5",
  // Gentle spectral shaping around the measured dominant region; this is not
  // a fixed synthetic tone and does not flatten the speaker's intonation.
  "equalizer=f=203.12:t=q:w=1.0:g=1.2",
  "equalizer=f=334.02:t=q:w=1.0:g=0.5",
  // A small presence lift makes dictionary pronunciation intelligible without
  // changing the speaker into a different person or adding artificial reverb.
  "equalizer=f=2500:t=q:w=0.8:g=1.4",
  "equalizer=f=4200:t=q:w=1.0:g=0.7",
  // Deliberate, audible amplification for dictionary playback. loudnorm below
  // keeps it controlled, so louder does not become clipping or harshness.
  "volume=1.25",
  "acompressor=threshold=-24dB:ratio=2.5:attack=12:release=180:makeup=2.0:knee=2",
  "loudnorm=I=-17:TP=-3.1:LRA=7:linear=true:print_format=summary",
].filter(Boolean).join(",");

await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-i", input,
  "-af", filters,
  "-ac", "1",
  "-ar", "48000",
  "-c:a", "libopus",
  "-b:a", process.env.OPUS_BITRATE ?? "48k",
  "-application", "audio",
  output,
]);

console.log(JSON.stringify({ input, output, targetF0Hz: TARGET_F0_HZ, sourceF0Hz: sourceF0, pitchRatio, filters }));

#!/usr/bin/env node
/**
 * Lathe deterministic fixture generator (Milestone 0).
 *
 * Produces synthetic media with KNOWN ground truth so M2-M5 tests can assert
 * analysis accuracy against a manifest instead of eyeballing output:
 *
 *   pattern.mp4   30 s testsrc2 at 30 fps with burned frame numbers (frame-exact)
 *   tone.mp4      30 s 1 kHz tone with planted silences at 10.0-12.0 s and 25.0-27.5 s
 *   scenes.mp4    5 distinct color segments of 5 s (cuts at 5,10,15,20,25 s)
 *   speech.wav    per-word SAPI synthesis on a fixed schedule (um/uh fillers,
 *                 one 1.2 s planted pause, one planted 0.9 s silence)
 *   speech.mp4    static background video carrying speech.wav
 *   manifest.json expected analysis results (times, counts, tolerances)
 *
 * Determinism (M0 acceptance): all inputs are fixed constants; word timings
 * are measured from the actual synthesized audio, so the manifest contains
 * only machine-independent values. Two consecutive runs must produce a
 * byte-identical manifest and identical ffprobe stream summaries (fixtures
 * tests assert this).
 *
 * SAPI (Windows) is the speech source; on non-Windows runners the same
 * schedule is synthesized as tone bursts of identical duration (KNOWN_GAPS,
 * ADR-0008). Run: `node fixtures/generate.mjs [pattern|tone|scenes|speech|all]`
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const outDir = join(repo, "fixtures/out");
const which = process.argv[2] ?? "all";

const W = 640;
const H = 360;
const FPS = 30;

mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(" ")}`);
    console.error(res.stderr || res.stdout);
    process.exit(1);
  }
  return res;
}

function ffmpeg(args) {
  // Media inputs/outputs are relative to the out dir; everything else (the
  // generator, tests) uses absolute paths.
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: outDir });
}

function ffprobeJson(path) {
  const res = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]);
  return JSON.parse(res.stdout);
}

/** Duration in seconds of a media file (container duration). */
function durationS(path) {
  const info = ffprobeJson(path);
  return Number(info.format.duration);
}

function pad(n, len) {
  return String(n).padStart(len, "0");
}

/** Shape of the fixture manifest (documented in fixtures/README.md). */
const manifest = {
  version: "1.0.0",
  generator: "fixtures/generate.mjs",
  fps: FPS,
  resolution: { width: W, height: H },
  fixtures: {},
  speech: null,
};

function recordFixture(name, path, expected) {
  manifest.fixtures[name] = {
    path: `fixtures/out/${path}`,
    duration_s: durationS(join(outDir, path)),
    expected,
  };
}

// ---------------------------------------------------------------------------
// 1. pattern.mp4: frame-accurate reference pattern
// ---------------------------------------------------------------------------

function generatePattern() {
  const file = "pattern.mp4";
  const font = "C:/Windows/Fonts/arial.ttf";
  // Note: spawn passes args directly (no shell), so the filtergraph escapes
  // its own separators: '\:' for field separators and '\ ' for spaces.
  const drawtext = existsSync(font)
    ? // Verified against ffmpeg 9.0.2: quote the path (escaped colon inside),
      // quote the text (space inside). spawn passes args verbatim, no shell.
      `drawtext=fontfile='${font.replace(/:/g, "\\:")}':text='frame %{n}':fontsize=18:fontcolor=white:x=8:y=8`
    : null;
  ffmpeg([
    "-f", "lavfi",
    "-i", `testsrc2=s=${W}x${H}:d=30:r=${FPS}`,
    "-f", "lavfi",
    "-i", "anullsrc=r=48000:cl=mono:d=30",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", String(FPS),
    "-c:a", "aac", "-b:a", "128k",
    ...(drawtext ? ["-vf", drawtext] : []),
    "-shortest",
    file,
  ]);
  recordFixture("pattern", file, {
    duration_s: 30,
    frame_count: 900,
    fps: FPS,
    has_silent_audio: true,
    expected_frames: { t_0s: 0, t_10s: 300, t_29_97s: 899 },
  });
}

// ---------------------------------------------------------------------------
// 2. tone.mp4: 1 kHz tone with planted silences
// ---------------------------------------------------------------------------

function generateTone() {
  const file = "tone.mp4";
  const silences = [
    { s: 10.0, e: 12.0 },
    { s: 25.0, e: 27.5 },
  ];
  const expr = silences
    .map((si) => `between(t,${si.s},${si.e})`)
    .join("+");
  ffmpeg([
    "-f", "lavfi",
    "-i", `sine=frequency=1000:sample_rate=48000:duration=30`,
    "-f", "lavfi",
    "-i", `testsrc2=s=${W}x${H}:d=30:r=${FPS}`,
    "-af", `volume=enable='${expr}':volume=0`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", String(FPS),
    "-c:a", "aac", "-b:a", "128k",
    "-shortest",
    file,
  ]);
  recordFixture("tone", file, {
    duration_s: 30,
    tone_frequency_hz: 1000,
    silences,
    silence_tolerance_ms: 50,
    /** Integrated loudness measured by M5 must be finite and below -10 LUFS. */
    expect_loudness_below_lufs: -10,
  });
}

// ---------------------------------------------------------------------------
// 3. scenes.mp4: hard cuts at known timestamps
// ---------------------------------------------------------------------------

function generateScenes() {
  const file = "scenes.mp4";
  const colors = ["red", "green", "blue", "yellow", "magenta"];
  const inputs = [];
  const filters = [];
  colors.forEach((c, i) => {
    inputs.push("-f", "lavfi", "-i", `color=c=${c}:s=${W}x${H}:d=5:r=${FPS}`);
    filters.push(`[${i}:v]settb=AVTB,fps=${FPS}[v${i}]`);
  });
  const concatIn = colors.map((_, i) => `[v${i}]`).join("");
  filters.push(`${concatIn}concat=n=${colors.length}:v=1:a=0[vout]`);
  ffmpeg([
    ...inputs,
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=25",
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", `${colors.length}:a`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", String(FPS),
    "-c:a", "aac", "-b:a", "128k",
    "-shortest",
    file,
  ]);
  recordFixture("scenes", file, {
    duration_s: 25,
    scene_changes_s: [5, 10, 15, 20],
    scene_tolerance_ms: 66,
    shot_count: 5,
  });
}

// ---------------------------------------------------------------------------
// 4. speech: per-word synthesis with a fixed schedule
// ---------------------------------------------------------------------------

const SPEECH_WORDS = [
  "welcome", "back", "to", "the", "show",
  "today", "we", "have", "a", "great", "conversation",
  "about", "pricing", "experiments",
  "um", // planted filler
  "and", "the", "lessons", "we", "learned", "from", "them",
  "it", "is", "going", "to", "be", "good",
];

const WORD_GAP_S = 0.12;
const PLANTED_PAUSE_AFTER_INDEX = 13; // 1.2 s pause before "um"
const PLANTED_PAUSE_S = 1.2;
const PLANTED_SILENCE_AFTER_INDEX = 18; // 0.9 s silence before "learned"
const PLANTED_SILENCE_S = 0.9;

/** Trim leading/trailing silence so word timings reflect the spoken word. */
const TRIM_AF = [
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03",
  "areverse",
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03",
  "areverse",
  "aformat=channel_layouts=mono",
].join(",");

/** Synthesize one word to a trimmed WAV via Windows SAPI. true on success. */
function sapiWord(word, index) {
  if (process.platform !== "win32") return false;
  const raw = join(outDir, `speech_raw_${pad(index, 3)}.wav`);
  const ps = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "$s.Rate = 2;", // faster speech: keeps fixtures short and test times low
    `$s.SetOutputToWaveFile("${raw.replace(/\\/g, "\\\\")}");`,
    `$s.Speak("${word}");`,
    "$s.Dispose();",
  ].join(" ");
  const res = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8",
  });
  if (res.status !== 0 || !existsSync(raw)) {
    console.warn(`[fixtures] SAPI failed for word ${index} (${word}); using tone burst fallback`);
    return false;
  }
  ffmpeg(["-i", `speech_raw_${pad(index, 3)}.wav`, "-af", TRIM_AF, "-c:a", "pcm_s16le", `speech_word_${pad(index, 3)}.wav`]);
  return true;
}

/** Tone-burst fallback for non-Windows runners: same duration contract. */
function toneBurst(word, index, durationS) {
  const target = join(outDir, `speech_word_${pad(index, 3)}.wav`);
  ffmpeg([
    "-f", "lavfi",
    "-i", `sine=frequency=${600 + (index % 5) * 200}:sample_rate=48000:duration=${durationS}`,
    "-af", "aformat=channel_layouts=mono",
    "-c:a", "pcm_s16le",
    target,
  ]);
}

function generateSpeech() {
  const words = [];
  let usedSapi = 0;

  // Pass 1: synthesize words and measure actual durations (deterministic order).
  const measured = [];
  for (let i = 0; i < SPEECH_WORDS.length; i++) {
    const word = SPEECH_WORDS[i];
    const ok = sapiWord(word, i);
    const wav = join(outDir, `speech_word_${pad(i, 3)}.wav`);
    if (ok) {
      usedSapi++;
      measured.push(durationS(wav));
    } else {
      // Deterministic fallback duration: proportional to word length.
      const d = Math.max(0.18, word.length * 0.06);
      toneBurst(word, i, d);
      measured.push(d);
    }
  }

  // Pass 2: schedule starts (fixed gaps; planted pauses at fixed word indexes).
  const starts = [];
  let cursor = 0.2; // lead-in
  for (let i = 0; i < SPEECH_WORDS.length; i++) {
    starts.push(cursor);
    cursor += measured[i] + WORD_GAP_S;
    if (i === PLANTED_PAUSE_AFTER_INDEX) cursor += PLANTED_PAUSE_S;
    if (i === PLANTED_SILENCE_AFTER_INDEX) cursor += PLANTED_SILENCE_S;
  }

  // Pass 3: render each word into a tiling segment (word + its tail gap/pause),
  // so the concatenated track has exactly the scheduled word boundaries.
  const segments = [];
  for (let i = 0; i < SPEECH_WORDS.length; i++) {
    const word = SPEECH_WORDS[i];
    const start = starts[i];
    const len = measured[i];
    const d = i < SPEECH_WORDS.length - 1 ? starts[i + 1] - start : len;
    const segName = `speech_seg_${pad(i, 3)}.wav`;
    ffmpeg([
      "-i", `speech_word_${pad(i, 3)}.wav`,
      "-af", `apad=whole_dur=${d.toFixed(3)},atrim=0:${d.toFixed(3)},asetpts=PTS-STARTPTS`,
      "-c:a", "pcm_s16le",
      segName,
    ]);
    segments.push(segName);
    words.push({ w: word, s: Number(start.toFixed(3)), e: Number((start + len).toFixed(3)), c: 1 });
  }

  // Concatenate into speech.wav (one audio stream; the concat demuxer exposes
  // every segment as its own stream, so map explicitly).
  const listFile = join(outDir, "speech_seg_list.txt");
  writeFileSync(listFile, segments.map((s) => `file '${s.replace(/\\/g, "/")}'`).join("\n"), "utf8");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-map", "0:a:0", "-c:a", "pcm_s16le", "speech.wav"]);

  // speech.mp4: static background carrying the track.
  const totalS = durationS(join(outDir, "speech.wav"));
  ffmpeg([
    "-f", "lavfi", "-i", `testsrc2=s=${W}x${H}:d=${totalS.toFixed(3)}:r=${FPS}`,
    "-i", "speech.wav",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", String(FPS),
    "-c:a", "aac", "-b:a", "128k",
    "-shortest",
    "speech.mp4",
  ]);

  const pauseStart = Number((words[PLANTED_PAUSE_AFTER_INDEX + 1].s - PLANTED_PAUSE_S).toFixed(3));
  const silenceStart = Number((words[PLANTED_SILENCE_AFTER_INDEX + 1].s - PLANTED_SILENCE_S).toFixed(3));
  const silences = [
    { s: pauseStart, e: words[PLANTED_PAUSE_AFTER_INDEX + 1].s, kind: "planted_pause", before: words[PLANTED_PAUSE_AFTER_INDEX + 1].w },
    { s: silenceStart, e: words[PLANTED_SILENCE_AFTER_INDEX + 1].s, kind: "planted_silence", before: words[PLANTED_SILENCE_AFTER_INDEX + 1].w },
  ];
  manifest.speech = {
    source: usedSapi === SPEECH_WORDS.length ? "windows-sapi" : `tone-burst-fallback(${SPEECH_WORDS.length - usedSapi} words)`,
    words,
    word_count: words.length,
    total_s: Number(totalS.toFixed(3)),
    fillers: ["um"],
    filler_word_indexes: [SPEECH_WORDS.indexOf("um")],
    planted_pauses: silences,
    /** M2 acceptance tolerances. */
    word_timing_tolerance_ms: 100,
    silence_tolerance_ms: 50,
    /** Adjacent-word gaps (between consecutive words) for false-start tests. */
    min_word_gap_s: WORD_GAP_S,
  };
  recordFixture("speech", "speech.wav", {
    duration_s: Number(totalS.toFixed(3)),
    word_count: words.length,
    words: words.map((w) => ({ w: w.w, s: w.s, e: w.e })),
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const jobs = {
  pattern: generatePattern,
  tone: generateTone,
  scenes: generateScenes,
  speech: generateSpeech,
};

if (which === "all") {
  for (const fn of Object.values(jobs)) fn();
} else if (which in jobs) {
  jobs[which]();
} else {
  console.error(`Unknown fixture set "${which}". Use: ${["all", ...Object.keys(jobs)].join(", ")}`);
  process.exit(1);
}

if (which === "all" || which === "speech") {
  // Speech manifest is part of the all-set manifest too; nothing else to do.
}

writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`[fixtures] wrote ${outDir} (${which})`);
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * Duration of a canonical PCM WAV from its RIFF header — no ffprobe spawn
 * (spawns cost ~3 s on this machine; the generator must stay fast).
 * fmt chunk layout: "fmt "(4) size(4) audioFormat(2) channels(2)
 *                   sampleRate(4) byteRate(4) blockAlign(2) bitsPerSample(2)
 */
function wavDuration(file) {
  const buf = readFileSync(file);
  const fmtPos = buf.indexOf("fmt ", 12);
  if (fmtPos < 0) throw new Error(`no fmt chunk in ${file}`);
  const byteRate = buf.readUInt32LE(fmtPos + 16);
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "data") return size / byteRate;
    pos += 8 + size + (size % 2); // chunks are word-aligned
  }
  throw new Error(`no data chunk in ${file}`);
}

/**
 * Synthesize every word in ONE PowerShell process, using a fresh synthesizer
 * instance per word (retargeting one instance's output file corrupts the
 * previous file's header on this SAPI build). A .ps1 file avoids all shell
 * quoting issues. Returns true when SAPI produced all words.
 */
function sapiWordsAll() {
  if (process.platform !== "win32") return false;
  const ps1 = join(outDir, "synthesize.ps1");
  const lines = [
    "Add-Type -AssemblyName System.Speech;",
    "$ErrorActionPreference = 'Stop';",
    `$outDir = '${outDir.replace(/\\/g, "\\\\")}';`,
  ];
  SPEECH_WORDS.forEach((w, i) => {
    const file = `(Join-Path $outDir ('speech_raw_{0:000}.wav' -f ${i}))`;
    lines.push(`$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;`);
    lines.push("$s.Rate = 2;"); // faster speech: short fixtures, fast tests
    lines.push(`$s.SetOutputToWaveFile(${file});`);
    lines.push(`$s.Speak('${w}');`);
    lines.push(`$s.Dispose();`);
  });
  lines.push("exit 0;");
  writeFileSync(ps1, lines.join("\n"), "utf8");
  const res = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-File", ps1], {
    encoding: "utf8",
    timeout: 180000,
  });
  if (res.status !== 0) {
    console.warn(`[fixtures] SAPI synthesis failed (exit ${res.status}); using tone burst fallback`);
    return false;
  }
  return SPEECH_WORDS.every((_, i) => existsSync(join(outDir, `speech_raw_${pad(i, 3)}.wav`)));
}

function generateSpeech() {
  const words = [];
  let usedSapi = 0;

  // Pass 1: synthesize (one PowerShell, fresh instance per word).
  const sapiOk = sapiWordsAll();

  // Pass 2: ONE ffmpeg call produces the per-word trimmed (or burst) WAVs.
  // 28 separate spawns cost ~3 s each on this machine.
  const inputs = [];
  const outputs = [];
  if (sapiOk) {
    for (let i = 0; i < SPEECH_WORDS.length; i++) {
      inputs.push("-i", `speech_raw_${pad(i, 3)}.wav`);
      outputs.push("-map", `${i}:a`, "-af", TRIM_AF, `speech_word_${pad(i, 3)}.wav`);
    }
    ffmpeg([...inputs, ...outputs]);
    usedSapi = SPEECH_WORDS.length;
  } else {
    // Tone-burst fallback (non-Windows): same duration contract.
    for (let i = 0; i < SPEECH_WORDS.length; i++) {
      const d = Math.max(0.18, SPEECH_WORDS[i].length * 0.06);
      inputs.push("-f", "lavfi", "-i", `sine=frequency=${600 + (i % 5) * 200}:sample_rate=48000:duration=${d.toFixed(3)}`);
      outputs.push("-map", `${i}:a`, `speech_word_${pad(i, 3)}.wav`);
    }
    ffmpeg([...inputs, ...outputs, "-c:a", "pcm_s16le"]);
  }

  // Pass 3: measure the ACTUAL per-word durations (what the audio contains).
  const measured = [];
  for (let i = 0; i < SPEECH_WORDS.length; i++) {
    measured.push(wavDuration(join(outDir, `speech_word_${pad(i, 3)}.wav`)));
  }

  // Pass 4: schedule starts (fixed gaps; planted pauses at fixed word indexes).
  const starts = [];
  let cursor = 0.2; // lead-in
  for (let i = 0; i < SPEECH_WORDS.length; i++) {
    starts.push(cursor);
    cursor += measured[i] + WORD_GAP_S;
    if (i === PLANTED_PAUSE_AFTER_INDEX) cursor += PLANTED_PAUSE_S;
    if (i === PLANTED_SILENCE_AFTER_INDEX) cursor += PLANTED_SILENCE_S;
  }

  // Pass 5: ONE ffmpeg call tiles + concatenates into speech.wav.
  const tileInputs = [];
  const filters = [];
  const concatInputs = [];
  for (let i = 0; i < SPEECH_WORDS.length; i++) {
    const d = i < SPEECH_WORDS.length - 1 ? starts[i + 1] - starts[i] : measured[i];
    tileInputs.push("-i", `speech_word_${pad(i, 3)}.wav`);
    filters.push(`[${i}:a]apad=whole_dur=${d.toFixed(3)},atrim=0:${d.toFixed(3)},asetpts=PTS-STARTPTS[seg${i}]`);
    concatInputs.push(`[seg${i}]`);
    words.push({
      w: SPEECH_WORDS[i],
      s: Number(starts[i].toFixed(3)),
      e: Number((starts[i] + measured[i]).toFixed(3)),
      c: 1,
    });
  }
  filters.push(`${concatInputs.join("")}concat=n=${SPEECH_WORDS.length}:v=0:a=1[out]`);
  ffmpeg([...tileInputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", "speech.wav"]);

  // speech.mp4: static background carrying the track.
  const totalS = wavDuration(join(outDir, "speech.wav"));
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
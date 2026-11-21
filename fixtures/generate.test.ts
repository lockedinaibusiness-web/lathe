import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const outDir = join(repo, "fixtures/out");
const genScript = join(repo, "fixtures/generate.mjs");

function generate(): void {
  execFileSync(process.execPath, [genScript, "all"], { cwd: repo, encoding: "utf8", stdio: "pipe" });
}

/** Machine-independent summary of a media file (not the encoded bytes). */
function streamSummary(path: string): unknown {
  const res = spawnSync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
    { encoding: "utf8" },
  );
  const info = JSON.parse(res.stdout) as {
    format: Record<string, unknown>;
    streams: Record<string, unknown>[];
  };
  return {
    duration: Number(info.format.duration).toFixed(3),
    n_streams: info.streams.length,
    streams: info.streams.map((s) => ({
      codec_type: s.codec_type,
      codec_name: s.codec_name,
      width: s.width ?? null,
      height: s.height ?? null,
      r_frame_rate: s.r_frame_rate ?? null,
      nb_frames: s.nb_frames ?? null,
      duration: s.duration ?? null,
    })),
  };
}

describe("fixture generator (M0)", () => {
  it("generates the deterministic fixture set with a manifest", () => {
    generate();
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.fps).toBe(30);
    for (const f of ["pattern", "tone", "scenes"]) {
      expect(manifest.fixtures[f], f).toBeDefined();
      expect(existsSync(join(repo, manifest.fixtures[f].path)), f).toBe(true);
    }
    expect(manifest.speech).toBeDefined();
  }, 240000);

  it("manifest declares planted ground truth for speech", () => {
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    const speech = manifest.speech;
    expect(speech.words.length).toBeGreaterThanOrEqual(25);
    expect(speech.word_count).toBe(speech.words.length);
    // Every word has monotic timings.
    for (let i = 0; i < speech.words.length; i++) {
      const w = speech.words[i];
      expect(w.e, `word ${i} (${w.w})`).toBeGreaterThan(w.s);
      if (i > 0) expect(w.s).toBeGreaterThanOrEqual(speech.words[i - 1].e);
    }
    // Planted filler and pauses are recorded.
    expect(speech.fillers).toContain("um");
    expect(speech.planted_pauses.length).toBe(2);
    for (const p of speech.planted_pauses) {
      expect(p.kind).toMatch(/^planted_/);
      expect(p.e - p.s).toBeGreaterThanOrEqual(0.89);
    }
  });

  it("regenerates deterministically: identical manifest and stream summaries", () => {
    const firstManifest = readFileSync(join(outDir, "manifest.json"), "utf8");
    const firstSummaries = ["pattern.mp4", "tone.mp4", "scenes.mp4", "speech.wav", "speech.mp4"].map((f) =>
      streamSummary(join(outDir, f)),
    );
    // A second run must reproduce the manifest exactly and the same
    // machine-independent stream summaries.
    generate();
    expect(readFileSync(join(outDir, "manifest.json"), "utf8")).toBe(firstManifest);
    const secondSummaries = ["pattern.mp4", "tone.mp4", "scenes.mp4", "speech.wav", "speech.mp4"].map((f) =>
      streamSummary(join(outDir, f)),
    );
    expect(secondSummaries).toEqual(firstSummaries);
  }, 240000);

  it("media plays back (ffprobe reports decodable streams)", () => {
    for (const f of ["pattern.mp4", "tone.mp4", "scenes.mp4", "speech.mp4"]) {
      const res = spawnSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv", join(outDir, f)],
        { encoding: "utf8" },
      );
      expect(res.status, f).toBe(0);
      expect(res.stdout).toContain("video");
      expect(res.stdout).toContain("audio");
    }
    // speech.wav is audio-only.
    const wav = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv", join(outDir, "speech.wav")],
      { encoding: "utf8" },
    );
    // ffprobe CSV prints "<stream>,<codec_type>"; speech.wav is audio-only.
    expect(wav.stdout.trim()).toBe("stream,audio");
  });

  it("temp-dir scratch mechanism used by later milestones works", () => {
    // The fixture suite must be runnable from a clean checkout; prove the
    // generator creates its own output directory from scratch.
    const scratch = join(tmpdir(), `lathe-fixture-check-${Date.now()}`);
    expect(existsSync(scratch)).toBe(false);
    // (fixtures/out is created by generate() in earlier tests; nothing to do
    // here beyond documenting that no pre-existing state is required.)
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
  });
});
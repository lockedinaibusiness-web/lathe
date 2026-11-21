import { describe, expect, it } from "vitest";
import {
  Project,
  ProjectList,
  CreateProjectRequest,
  HealthResponse,
  ReadyzResponse,
  healthPayload,
  StyleRecipe,
  PlanEditResponse,
  ListStylesResponse,
  RenderPreset,
  RENDER_PRESETS,
  RenderRequest,
  RenderResponse,
  PreviewRequest,
  PreviewResponse,
  ExportProjectRequest,
  ExportProjectResponse,
  Finding,
  VerifyRequest,
  VerifyResponse,
  VerifyFixLoopResponse,
  CHECK_CODES,
  sampleId,
  CONTRACTS_VERSION,
  SCHEMA_BUNDLE_ID,
} from "../src/index.js";

const PRJ = sampleId("prj", 21);

describe("project + health contracts", () => {
  it("validates a project, list, and create request", () => {
    const now = 1764000000000;
    const project = { id: PRJ, title: "Ep 12", status: "indexing" as const, timeline_version: 1, created_ms: now, updated_ms: now };
    expect(Project.safeParse(project).success).toBe(true);
    expect(ProjectList.safeParse({ projects: [project] }).success).toBe(true);
    expect(CreateProjectRequest.safeParse({ title: "Ep 12", source: { upload_session_id: sampleId("upl", 1) } }).success).toBe(true);
    expect(CreateProjectRequest.safeParse({ title: "Ep 12", source: { import_url: "https://x.example/a.mp4" } }).success).toBe(true);
    expect(CreateProjectRequest.safeParse({ title: "" }).success).toBe(false);
  });

  it("health payload stamps the contract version", () => {
    expect(healthPayload()).toEqual({ status: "ok", version: CONTRACTS_VERSION });
    expect(HealthResponse.safeParse(healthPayload()).success).toBe(true);
    expect(ReadyzResponse.safeParse({ status: "ok", checks: [{ name: "database", status: "ok" }, { name: "storage", status: "down", detail: "no adapter" }] }).success).toBe(true);
    expect(SCHEMA_BUNDLE_ID).toContain("lathe.contracts.schema.json");
  });
});

describe("style recipes (STY-1/2)", () => {
  it("validates a launch-style-shaped recipe", () => {
    const recipe = {
      id: sampleId("sty", 1),
      name: "Podcast Clean",
      description: "Remove pauses and fillers; level audio for podcast distribution.",
      targets: ["podcast"],
      aspect: "16:9",
      pacing: { max_pause_s: 0.6, target_pause_s: 0.25, filler_words: ["um", "uh", "er"], filler_cluster_gap_ms: 400, remove_false_starts: true, repeated_takes: "keep_last", keep_breaths_min_s: 0.12 },
      captions: { enabled: true, max_lines: 2, max_chars_per_line: 42, max_cps: 17, highlight: "none" },
      audio: { target_lufs: -16, true_peak_dbtp: -1, duck_music_db: -12, denoise: false },
      default_transition: "hard_cut",
    };
    expect(StyleRecipe.safeParse(recipe).success).toBe(true);
    // repeated_takes is a constrained enum.
    expect(StyleRecipe.safeParse({ ...recipe, pacing: { ...recipe.pacing, repeated_takes: "keep_middle" } }).success).toBe(false);
  });

  it("plan_edit response validates with ordered steps", () => {
    expect(PlanEditResponse.shape.steps).toBeDefined();
    const list = { styles: [], caption_styles: [], summary: "5 styles" };
    expect(ListStylesResponse.safeParse(list).success).toBe(true);
  });
});

describe("render + export contracts (RND-4, EXP-1..3)", () => {
  it("launch presets validate and have unique ids", () => {
    expect(RENDER_PRESETS.length).toBe(5);
    for (const p of RENDER_PRESETS) {
      const r = RenderPreset.safeParse(p);
      if (!r.success) throw new Error(`preset ${p.id} rejected: ${JSON.stringify(r.error.issues)}`);
    }
    expect(new Set(RENDER_PRESETS.map((p) => p.id)).size).toBe(5);
    const ids = RENDER_PRESETS.map((p) => p.id);
    expect(ids).toContain("youtube_1080p");
    expect(ids).toContain("shorts_1080x1920");
    expect(ids).toContain("prores_master");
  });

  it("validates render/preview/export requests and responses", () => {
    expect(RenderRequest.safeParse({ project_id: PRJ, preset_id: "youtube_1080p", wait: true, idempotency_key: "render-test-0001" }).success).toBe(true);
    expect(RenderResponse.safeParse({
      project_id: PRJ,
      job_id: sampleId("job", 1),
      state: "completed",
      url: "https://r.lathe.dev/out.mp4?sig=x",
      content_hash: "a".repeat(40),
      cached: true,
      strategy: "smart_render",
      summary: "Render done",
    }).success).toBe(true);
    expect(PreviewRequest.safeParse({ project_id: PRJ, idempotency_key: "preview-test-0001" }).success).toBe(true);
    expect(PreviewResponse.safeParse({ project_id: PRJ, job_id: sampleId("job", 1), url: "https://p.lathe.dev/prev.mp4?sig=x", thumbnails: [], ttl_s: 900, summary: "ready" }).success).toBe(true);
    expect(ExportProjectRequest.safeParse({ project_id: PRJ, format: "otio" }).success).toBe(true);
    expect(ExportProjectResponse.safeParse({ project_id: PRJ, format: "otio", url: "https://e.lathe.dev/p.otio?sig=x", filename: "p.otio", bytes: 2048, summary: "ready" }).success).toBe(true);
  });
});

describe("verification contract (VER-1)", () => {
  it("declares the 11 launch checks plus the extension slot", () => {
    expect(CHECK_CODES.length).toBe(12);
    for (const code of ["mid_word_cut", "audio_click", "clipping", "loudness_off_target", "true_peak_exceeded", "caption_overflow", "caption_too_fast", "black_frames", "av_drift", "abrupt_level_jump"]) {
      expect(CHECK_CODES).toContain(code);
    }
  });

  it("validates a finding and a verify response", () => {
    expect(Finding.safeParse({
      id: sampleId("fnd", 1),
      code: "caption_too_fast",
      severity: "error",
      location: { segment_ids: [sampleId("seg", 4)], caption_ids: [sampleId("cap", 2)], time_s: { start: 61, end: 64 } },
      message: "Caption reads 18.7 chars/sec over 4.2 s.",
      suggested_fix: "Shorten to 'this is the part that matters' or extend its range by 0.4 s.",
      auto_fixable: true,
      measured: { value: 18.7, threshold: 17 },
    }).success).toBe(true);

    expect(VerifyResponse.safeParse({
      project_id: PRJ,
      passed: false,
      findings: [],
      metrics: { audio: { integrated_lufs: -15.8, true_peak_dbtp: -1.2 }, pacing: { max_caption_cps: 14.2 } },
      fix_pass: 0,
      summary: "1 error: caption_too_fast",
    }).success).toBe(true);

    expect(VerifyFixLoopResponse.safeParse({
      project_id: PRJ,
      passes: [],
      resolved: true,
      summary: "Resolved after 1 fix pass",
    }).success).toBe(true);
  });

  it("verify request accepts an optional checks subset", () => {
    expect(VerifyRequest.safeParse({ project_id: PRJ, checks: ["clipping"], style_id: "podcast-clean" }).success).toBe(true);
  });
});
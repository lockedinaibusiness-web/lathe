/**
 * MCP tool definitions, part C: styling, media tools, and pipeline tools.
 */

import { z } from "zod";
import { defineTool, type McpToolDef } from "./registry.js";
import { Summary } from "../common.js";
import { JobId, ProjectId, StyleId } from "../ids.js";
import { PreviewRequest, RenderRequest, RenderResponse, ExportProjectRequest } from "../render.js";
import { VerifyRequest, VerifyResponse } from "../verify.js";

export const addCaptionsTool: McpToolDef = defineTool({
  name: "add_captions",
  title: "Add captions",
  description:
    "Generate captions from the transcript and apply a caption style (font, highlight mode, position, max lines/chars). Captions are timed from word timestamps, so they stay in sync after edits. Reading speed is capped at the style's max chars/second; pass max_cps to override.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "BRIEF_NOT_READY", "STYLE_NOT_FOUND", "VERSION_CONFLICT"],
  examples: [
    {
      title: "Word-highlight captions for a talking head",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        style_id: "sty_01J8ZQ4K2M9T3X7YB6N0PWABC1",
        max_cps: 17,
        base_version: 20,
        idempotency_key: "captions_2026-11-21_01",
      },
      output_summary:
        "Added 312 captions with word highlight, 2 lines max, 42 chars/line; all within 17 CPS. Timeline v20 -> v21.",
    },
    {
      title: "Captions for a time range only",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        range: { kind: "time", start_s: 0, end_s: 120 },
        style_id: "sty_01J8ZQ4K2M9T3X7YB6N0PWABC2",
      },
      output_summary: "Added 24 captions covering the first 2 minutes; untouched outside the range.",
    },
  ],
  input: z.object({
    project_id: ProjectId,
    style_id: StyleId.optional(),
    max_lines: z.number().int().min(1).max(4).optional(),
    max_chars_per_line: z.number().int().min(8).max(64).optional(),
    max_cps: z.number().positive().optional(),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
    range: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("segments"), ids: z.array(z.string()).min(1).max(500) }),
      z.object({ kind: z.literal("time"), start_s: z.number().nonnegative(), end_s: z.number().nonnegative() }),
    ]).optional(),
    apply: z.boolean().default(true),
    base_version: z.number().int().nonnegative().optional(),
    idempotency_key: z.string().min(8).max(128).optional(),
  }),
  output: z.object({
    applied: z.boolean(),
    batch_id: z.string().regex(/^btc_[A-Za-z0-9]{10,64}$/).optional(),
    captions_added: z.number().int().nonnegative(),
    caption_ids: z.array(z.string()).max(5000),
    style_id: StyleId.optional(),
    summary: Summary,
  }),
});

export const reframeTool: McpToolDef = defineTool({
  name: "reframe",
  title: "Reframe",
  description:
    "Reframe the video to another aspect ratio (e.g. 16:9 -> 9:16). Subject tracking follows the active speaker/face with smoothing so the crop does not jitter. Use before exporting vertical formats. Returns the crops chosen per range so you can verify with get_frames.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "OP_TARGET_NOT_FOUND", "OP_INVALID_PARAMS", "VERSION_CONFLICT"],
  examples: [
    {
      title: "Reframe to vertical with subject tracking",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        aspect: "9:16",
        mode: "subject",
        smoothing_s: 0.5,
        base_version: 30,
        idempotency_key: "reframe_2026-11-21_01",
      },
      output_summary: "Reframed 42 clips to 9:16 with speaker tracking (max crop drift 0.04 of frame). Timeline v30 -> v31.",
    },
    {
      title: "Manual square crop offset to the left",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        aspect: "1:1",
        mode: "manual",
        offset_x: -0.3,
      },
      output_summary: "Reframed to 1:1 with a fixed -0.3 horizontal offset (guest sits screen-left).",
    },
  ],
  input: z.object({
    project_id: ProjectId,
    aspect: z.enum(["16:9", "9:16", "1:1", "4:5", "4:3", "custom"]),
    custom_w: z.number().int().positive().optional(),
    custom_h: z.number().int().positive().optional(),
    mode: z.enum(["subject", "face", "center", "manual"]).default("subject"),
    smoothing_s: z.number().min(0).max(2).default(0.5),
    offset_x: z.number().min(-1).max(1).optional(),
    offset_y: z.number().min(-1).max(1).optional(),
    range: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("segments"), ids: z.array(z.string()).min(1).max(500) }),
      z.object({ kind: z.literal("time"), start_s: z.number().nonnegative(), end_s: z.number().nonnegative() }),
    ]).optional(),
    apply: z.boolean().default(true),
    base_version: z.number().int().nonnegative().optional(),
    idempotency_key: z.string().min(8).max(128).optional(),
  }),
  output: z.object({
    applied: z.boolean(),
    batch_id: z.string().regex(/^btc_[A-Za-z0-9]{10,64}$/).optional(),
    clips_reframed: z.number().int().nonnegative(),
    crops: z.array(
      z.object({ clip_id: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    ).max(5000),
    summary: Summary,
  }),
});

export const audioCleanupTool: McpToolDef = defineTool({
  name: "audio_cleanup",
  title: "Audio cleanup",
  description:
    "One-call audio chain: optional denoise, loudness normalization to a target with a true-peak ceiling, and music ducking under speech. The verify step checks the result (integrated loudness within 1 LU, true peak under -1 dBTP).",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "OP_INVALID_PARAMS", "VERSION_CONFLICT"],
  examples: [
    {
      title: "Standard podcast cleanup",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        denoise: false,
        target_lufs: -16,
        true_peak_dbtp: -1,
        duck_music_db: -12,
        base_version: 40,
        idempotency_key: "audio_2026-11-21_01",
      },
      output_summary: "Normalized to -16.1 LUFS (peak -1.2 dBTP), music ducked 12 dB under speech. Timeline v40 -> v41.",
    },
    {
      title: "Denoise and lift a quiet recording",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        denoise: true,
        target_lufs: -14,
        true_peak_dbtp: -1.5,
      },
      output_summary: "Denoised and lifted to -14 LUFS; loudness will be re-checked by verify.",
    },
  ],
  input: z.object({
    project_id: ProjectId,
    denoise: z.boolean().default(false),
    target_lufs: z.number().min(-40).max(-5).default(-16),
    true_peak_dbtp: z.number().min(-6).max(-0.3).default(-1),
    duck_music_db: z.number().min(-60).max(0).optional(),
    apply: z.boolean().default(true),
    base_version: z.number().int().nonnegative().optional(),
    idempotency_key: z.string().min(8).max(128).optional(),
  }),
  output: z.object({
    applied: z.boolean(),
    batch_id: z.string().regex(/^btc_[A-Za-z0-9]{10,64}$/).optional(),
    measured: z
      .object({ integrated_lufs: z.number().finite(), true_peak_dbtp: z.number().finite() })
      .optional(),
    summary: Summary,
  }),
});

export const findBrollTool: McpToolDef = defineTool({
  name: "find_broll",
  title: "Find B-roll",
  description:
    "Search the project's own library (other uploaded assets) by text description, or propose stock results, for B-roll to cover a stretch of talk. With apply, insert the chosen clip at the given time with audio ducked. Stock providers are metered and always explicit.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "ASSET_NOT_FOUND", "OP_INVALID_PARAMS", "VERSION_CONFLICT"],
  examples: [
    {
      title: "Find library B-roll for a product mention",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        query: "hands typing on laptop close up",
        source: "library",
        limit: 5,
      },
      output_summary: "5 library clips; best match ast_... (screen-recording-02.mov) at 12.4s in.",
    },
    {
      title: "Insert the chosen B-roll over a 4-second stretch",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        query: "city skyline sunset",
        source: "library",
        at_s: 312.5,
        duration_s: 4,
        audio: "duck",
        apply: true,
        base_version: 51,
        idempotency_key: "broll_2026-11-21_01",
      },
      output_summary: "Inserted 4s B-roll at 05:12 with speech ducked; timeline v51 -> v52.",
    },
  ],
  input: z.object({
    project_id: ProjectId,
    query: z.string().min(1).max(200),
    source: z.enum(["library", "stock"]).default("library"),
    limit: z.number().int().min(1).max(20).default(5),
    at_s: z.number().nonnegative().optional(),
    duration_s: z.number().min(0.2).max(120).optional(),
    audio: z.enum(["mute", "keep", "duck"]).default("duck"),
    apply: z.boolean().default(false),
    base_version: z.number().int().nonnegative().optional(),
    idempotency_key: z.string().min(8).max(128).optional(),
  }),
  output: z.object({
    candidates: z.array(
      z.object({
        asset_id: z.string(),
        name: z.string(),
        score: z.number().min(0).max(1),
        in_s: z.number().nonnegative().finite(),
        duration_s: z.number().nonnegative().finite(),
        signed_url: z.string().url().optional(),
      }),
    ),
    inserted: z.boolean().default(false),
    summary: Summary,
  }),
});

export const translateTool: McpToolDef = defineTool({
  name: "translate",
  title: "Translate captions",
  description:
    "Translate the project's captions to another language, producing new caption tracks timed to the existing words. Dubbing is P2 and metered; pass dub to see the estimated cost instead of producing audio.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "BRIEF_NOT_READY", "VERSION_CONFLICT"],
  examples: [
    {
      title: "Translate captions to Spanish",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        target_language: "es",
        base_version: 60,
        idempotency_key: "translate_2026-11-21_01",
      },
      output_summary: "Added 312 Spanish captions (original timing); 6 long lines wrapped to fit 42 chars.",
    },
    {
      title: "Ask about dubbing cost before committing",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        target_language: "fr",
        dub: true,
      },
      output_summary: "Dubbing estimate: 42 min of audio, 1 voice; proceed with apply=true to spend the quota.",
    },
  ],
  input: z.object({
    project_id: ProjectId,
    target_language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    dub: z.boolean().default(false),
    apply: z.boolean().default(true),
    base_version: z.number().int().nonnegative().optional(),
    idempotency_key: z.string().min(8).max(128).optional(),
  }),
  output: z.object({
    applied: z.boolean(),
    captions_added: z.number().int().nonnegative(),
    language: z.string(),
    dub_estimate: z
      .object({ minutes: z.number().nonnegative().finite(), cost_credits: z.number().nonnegative() })
      .optional(),
    summary: Summary,
  }),
});

export const previewTool: McpToolDef = defineTool({
  name: "preview",
  title: "Preview",
  description:
    "Render a low-resolution proxy preview of the current timeline (or a range) and return a playable signed link plus thumbnails. First playable result arrives in seconds and never waits on the full-quality pipeline. Use it after apply_edits to sanity-check pacing before render.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "JOB_FAILED"],
  examples: [
    {
      title: "Preview the whole timeline",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        idempotency_key: "preview-ep12-0001",
      },
      output_summary: "Proxy preview ready in 3.1 s (36:48 of edit), link valid 15 min, 8 thumbnails.",
    },
    {
      title: "Preview just the first minute",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        range: { start_s: 0, end_s: 60 },
        idempotency_key: "preview-ep12-0002",
      },
      output_summary: "Proxy preview of 0-60 s ready in 1.4 s.",
    },
  ],
  input: PreviewRequest,
  output: z.object({
    job_id: JobId,
    url: z.string().url(),
    thumbnails: z.array(z.string().url()),
    ttl_s: z.number().int().positive(),
    summary: Summary,
  }),
});

export const verifyTool: McpToolDef = defineTool({
  name: "verify",
  title: "Verify",
  description:
    "Run the deterministic quality checks against a fresh render of the current timeline: mid-word cuts, clicks, clipping, loudness vs target, true peak, caption overflow/reading speed, black frames, A/V drift, abrupt level jumps. Findings come with segment/clip locations and a suggested_fix you can act on; pass them into apply_edits. Up to 3 fix passes are allowed.",
  annotations: { readOnlyHint: true },
  scopes: ["project:read"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "JOB_FAILED"],
  examples: [
    {
      title: "Verify after a cleanup batch",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD" },
      output_summary:
        "PASS: 0 errors. Measured -15.8 LUFS (target -16, tolerance 1), peak -1.4 dBTP, max caption speed 14.2 CPS.",
    },
    {
      title: "Verify finds a caption problem",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD", checks: ["caption_too_fast", "caption_overflow"] },
      output_summary:
        "1 error: caption_too_fast at 21:04 (18.7 CPS vs 17) on cap_...; fix: shorten to 'this is the part that matters' or extend its range.",
    },
  ],
  input: VerifyRequest,
  output: z.object({
    passed: z.boolean(),
    findings: VerifyResponse.shape.findings,
    metrics: VerifyResponse.shape.metrics,
    fix_pass: z.number().int().min(0).max(3),
    summary: Summary,
  }),
});

export const renderTool: McpToolDef = defineTool({
  name: "render",
  title: "Render",
  description:
    "Start a full-quality render at a preset (youtube_1080p, shorts_1080x1920, web_720p, prores_master, audio_only). Smart render stream-copies unchanged GOPs and re-encodes only affected ranges, with automatic fallback to a full re-encode; results are cached by content hash so an unchanged re-export is instant. Set wait=true to block for the result.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "RENDER_FAILED", "RATE_LIMITED"],
  examples: [
    {
      title: "Render the YouTube master",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        preset_id: "youtube_1080p",
        wait: true,
        idempotency_key: "render-ep12-yt-0001",
      },
      output_summary: "Render completed in 18.4 s (smart render, 3 of 12 GOPs re-encoded). 720p master cached from earlier.",
    },
    {
      title: "Queue a vertical render and poll later",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        preset_id: "shorts_1080x1920",
        wait: false,
        idempotency_key: "render-ep12-vertical-0001",
      },
      output_summary: "Render job job_... queued; poll get_status for progress.",
    },
  ],
  input: RenderRequest,
  output: z.object({
    job_id: JobId,
    state: z.enum(["queued", "active", "completed", "failed"]),
    url: z.string().url().optional(),
    content_hash: z.string().optional(),
    cached: z.boolean().default(false),
    strategy: z.enum(["full_reencode", "smart_render", "chunked_smart_render", "cached"]).optional(),
    metrics: RenderResponse.shape.metrics,
    error: z
      .object({ code: z.string(), message: z.string(), suggested_fix: z.string().optional() })
      .optional(),
    summary: Summary,
  }),
});

export const exportProjectTool: McpToolDef = defineTool({
  name: "export_project",
  title: "Export project",
  description:
    "Export the timeline as OpenTimelineIO (otio), Final Cut Pro XML (fcpxml), CMX EDL (edl), or captions as SRT/VTT sidecars. The exported file is a readable plan of every change, ready for Premiere, Resolve, or Final Cut.",
  annotations: { readOnlyHint: true },
  scopes: ["project:read"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "RATE_LIMITED"],
  examples: [
    {
      title: "Export OTIO for Resolve",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD", format: "otio" },
      output_summary: "lathe-ep12_v12.otio ready (214 KB): 2 video tracks, 1 audio track, all clips and captions.",
    },
    {
      title: "Export an SRT sidecar",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD", format: "srt" },
      output_summary: "lathe-ep12.srt ready (64 KB): 312 captions in timeline order.",
    },
  ],
  input: ExportProjectRequest,
  output: z.object({
    format: z.string(),
    url: z.string().url(),
    filename: z.string(),
    bytes: z.number().int().nonnegative().optional(),
    summary: Summary,
  }),
});
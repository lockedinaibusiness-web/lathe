/**
 * Render + export contracts (RND-1..6, EXP-1..3).
 *
 * The full-quality render first, smart render as a verified optimization (M4).
 * Presets are data, not code. Cache keys are content hashes of
 * (timeline, asset hashes, preset).
 */

import { z } from "zod";
import type { AssetId } from "./ids.js";
import { ProjectId, JobId } from "./ids.js";
import { Summary } from "./common.js";

export const VideoCodec = z.enum(["h264", "hevc", "prores", "av1", "vp9"]);
export type VideoCodec = z.infer<typeof VideoCodec>;

export const AudioCodec = z.enum(["aac", "pcm_s16le", "opus"]);
export type AudioCodec = z.infer<typeof AudioCodec>;

export const Container = z.enum(["mp4", "mov", "webm", "mkv", "wav"]);
export type Container = z.infer<typeof Container>;

export const RenderPreset = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{2,64}$/),
    name: z.string().min(1).max(64),
    container: Container,
    video_codec: VideoCodec,
    audio_codec: AudioCodec,
    /** 0x0 = audio-only output; otherwise both must be positive. */
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    fps: z.number().positive().finite().optional().describe("null = match source"),
    /** Bitrate ladder in kbps; null = codec default/quality-based. */
    video_bitrate_kbps: z.number().int().positive().optional(),
    crf: z.number().int().min(0).max(51).optional(),
    profile: z.string().max(32).optional(),
    audio_bitrate_kbps: z.number().int().positive().optional(),
    /** Burn captions into the video (sidecar export is a separate flow). */
    burn_captions: z.boolean().default(false),
    /** Normalize loudness during render. */
    normalize: z
      .object({ target_lufs: z.number().finite(), true_peak_dbtp: z.number().finite() })
      .optional(),
    description: z.string().max(300),
  })
  .refine((p) => (p.width === 0 && p.height === 0) || (p.width > 0 && p.height > 0), {
    message: "width/height must both be 0 (audio-only) or both positive",
  });
export type RenderPreset = z.infer<typeof RenderPreset>;

/** Launch presets (RND-4). Values are the defaults; data files in M4 refine. */
export const RENDER_PRESETS: RenderPreset[] = [
  {
    id: "youtube_1080p",
    name: "YouTube 1080p",
    container: "mp4",
    video_codec: "h264",
    audio_codec: "aac",
    width: 1920,
    height: 1080,
    fps: 30,
    video_bitrate_kbps: 8000,
    audio_bitrate_kbps: 192,
    burn_captions: false,
    description: "Standard YouTube upload: H.264 High, AAC 192k, progressive.",
  },
  {
    id: "shorts_1080x1920",
    name: "Shorts / Reels / TikTok 9:16",
    container: "mp4",
    video_codec: "h264",
    audio_codec: "aac",
    width: 1080,
    height: 1920,
    fps: 30,
    video_bitrate_kbps: 6000,
    audio_bitrate_kbps: 192,
    burn_captions: true,
    normalize: { target_lufs: -14, true_peak_dbtp: -1 },
    description: "Vertical short-form with burned-in captions and -14 LUFS.",
  },
  {
    id: "web_720p",
    name: "Web 720p",
    container: "mp4",
    video_codec: "h264",
    audio_codec: "aac",
    width: 1280,
    height: 720,
    fps: 30,
    video_bitrate_kbps: 3000,
    audio_bitrate_kbps: 128,
    burn_captions: false,
    description: "Lightweight web/embed preset.",
  },
  {
    id: "prores_master",
    name: "ProRes Master",
    container: "mov",
    video_codec: "prores",
    audio_codec: "pcm_s16le",
    width: 1920,
    height: 1080,
    audio_bitrate_kbps: 1536,
    burn_captions: false,
    description: "Master for handoff to an NLE. ProRes 422 profile.",
  },
  {
    id: "audio_only",
    name: "Audio-only (podcast)",
    container: "wav",
    video_codec: "h264",
    audio_codec: "pcm_s16le",
    width: 0,
    height: 0,
    audio_bitrate_kbps: 1536,
    burn_captions: false,
    normalize: { target_lufs: -16, true_peak_dbtp: -1 },
    description: "Muxed-out WAV master at -16 LUFS for podcast distribution.",
  },
];

// ---------------------------------------------------------------------------
// preview / render / export tool contracts
// ---------------------------------------------------------------------------

export const PreviewRequest = z.object({
  project_id: ProjectId,
  /** Range in timeline seconds; default: the whole timeline. */
  range: z
    .object({ start_s: z.number().nonnegative(), end_s: z.number().nonnegative() })
    .optional(),
  /** Max seconds to wait before returning the first playable proxy result. */
  max_wait_s: z.number().min(0).max(60).default(5),
  idempotency_key: z.string().min(8).max(128).describe("Invariant #4: safe to retry"),
});
export type PreviewRequest = z.infer<typeof PreviewRequest>;

export const PreviewResponse = z.object({
  project_id: ProjectId,
  job_id: JobId,
  /** Signed proxy URL; playable while the full pipeline keeps working. */
  url: z.string().url(),
  thumbnails: z.array(z.string().url()).default([]),
  /** Seconds until this preview URL expires. */
  ttl_s: z.number().int().positive(),
  summary: Summary,
});
export type PreviewResponse = z.infer<typeof PreviewResponse>;

export const RenderRequest = z.object({
  project_id: ProjectId,
  preset_id: z.string().min(1).max(64),
  /** Smart render stream-copies unchanged GOPs; falls back automatically. */
  smart_render: z.boolean().default(true),
  /** Wait for completion and return the result inline (bounded by timeout_s). */
  wait: z.boolean().default(false),
  timeout_s: z.number().min(1).max(600).default(120),
  idempotency_key: z.string().min(8).max(128).describe("Invariant #4: safe to retry"),
});
export type RenderRequest = z.infer<typeof RenderRequest>;

export const RenderResponse = z.object({
  project_id: ProjectId,
  job_id: JobId,
  state: z.enum(["queued", "active", "completed", "failed"]),
  url: z.string().url().optional(),
  /** Content hash of (timeline, asset hashes, preset): cache identity. */
  content_hash: z.string().min(8).max(128).optional(),
  cached: z.boolean().default(false).describe("true when served from the render cache"),
  /** Which renderer path ran or is planned. */
  strategy: z.enum(["full_reencode", "smart_render", "chunked_smart_render", "cached"]).optional(),
  metrics: z
    .object({
      wall_s: z.number().nonnegative().finite().optional(),
      output_bytes: z.number().int().nonnegative().optional(),
      duration_s: z.number().nonnegative().finite().optional(),
    })
    .optional(),
  error: z
    .object({ code: z.string(), message: z.string(), suggested_fix: z.string().optional() })
    .optional(),
  summary: Summary,
});
export type RenderResponse = z.infer<typeof RenderResponse>;

export const ExportFormat = z.enum(["otio", "fcpxml", "edl", "srt", "vtt", "json"]);

export const ExportProjectRequest = z.object({
  project_id: ProjectId,
  format: ExportFormat,
  /** Caption exports: which captions (default: all). */
  caption_ids: z.array(z.string()).optional(),
});
export type ExportProjectRequest = z.infer<typeof ExportProjectRequest>;

export const ExportProjectResponse = z.object({
  project_id: ProjectId,
  format: ExportFormat,
  job_id: JobId.optional(),
  /** Signed download URL (short TTL). */
  url: z.string().url(),
  filename: z.string().min(1).max(200),
  /** Byte size when known synchronously. */
  bytes: z.number().int().nonnegative().optional(),
  summary: Summary,
});
export type ExportProjectResponse = z.infer<typeof ExportProjectResponse>;

/** Asset references used by render/plan contracts. */
export type { AssetId };
/**
 * Verification contract (VER-1..3).
 *
 * Deterministic quality checks run against the *rendered* output (or the
 * rendered plan when media is not yet available). Every finding carries
 * location (segment/clip IDs), a message, and a suggested_fix the model can
 * act on. Up to 3 automatic fix passes are allowed by the orchestrator.
 */

import { z } from "zod";
import { ProjectId, SegmentId, ShotId, ClipId, CaptionId, FindingId, JobId } from "./ids.js";
import { Severity, Summary } from "./common.js";

/** The 11 launch checks (VER-1) plus a catch-all. */
export const CHECK_CODES = [
  "mid_word_cut", // cut landed inside a spoken word
  "audio_click", // click/pop at a cut boundary (sample discontinuity)
  "clipping", // samples at/near full scale
  "loudness_off_target", // integrated loudness > 1 LU from target
  "true_peak_exceeded", // true peak above -1 dBTP
  "caption_overflow", // caption text off-screen or over max chars/lines
  "caption_too_fast", // reading speed above limit (chars/second)
  "black_frames", // > 2 consecutive black frames
  "av_drift", // A/V drift > 40 ms
  "abrupt_level_jump", // > 6 dB level jump across a cut
  "silence_over_budget", // pause longer than the style cap survived
  "custom_check", // extensibility slot for project-specific checks
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];

export const Finding = z.object({
  id: FindingId,
  code: z.enum(CHECK_CODES),
  severity: Severity,
  /** Where: stable IDs wherever possible, time ranges as a fallback. */
  location: z.object({
    segment_ids: z.array(SegmentId).optional(),
    shot_ids: z.array(ShotId).optional(),
    clip_ids: z.array(ClipId).optional(),
    caption_ids: z.array(CaptionId).optional(),
    time_s: z.object({ start: z.number().nonnegative(), end: z.number().nonnegative() }).optional(),
  }),
  message: z.string().min(1).max(500),
  suggested_fix: z.string().min(1).max(500),
  /** True when the orchestrator may auto-fix without asking the model. */
  auto_fixable: z.boolean(),
  /** Measured vs. threshold, for the finding that fired. */
  measured: z.object({ value: z.number().finite(), threshold: z.number().finite() }).optional(),
});
export type Finding = z.infer<typeof Finding>;

export const VerifyRequest = z.object({
  project_id: ProjectId,
  /** Optional rendering job to verify; when omitted the orchestrator renders a preview. */
  render_job_id: JobId.optional(),
  /** Restrict to these checks (default: all applicable). */
  checks: z.array(z.enum(CHECK_CODES)).optional(),
  /** Parameters from the active style recipe (caps, LUFS target, ...). */
  style_id: z.string().optional(),
});
export type VerifyRequest = z.infer<typeof VerifyRequest>;

export const AudioMetrics = z.object({
  integrated_lufs: z.number().finite(),
  true_peak_dbtp: z.number().finite(),
  max_sample_level_db: z.number().finite().optional(),
});
export type AudioMetrics = z.infer<typeof AudioMetrics>;

export const PacingMetrics = z.object({
  speech_ratio: z.number().min(0).max(1).optional(),
  silence_ratio: z.number().min(0).max(1).optional(),
  longest_pause_s: z.number().nonnegative().finite().optional(),
  cuts_per_minute: z.number().nonnegative().finite().optional(),
  max_caption_cps: z.number().nonnegative().finite().optional(),
});
export type PacingMetrics = z.infer<typeof PacingMetrics>;

export const VerifyResponse = z.object({
  project_id: ProjectId,
  /** true when zero error-severity findings. */
  passed: z.boolean(),
  findings: z.array(Finding),
  metrics: z.object({ audio: AudioMetrics, pacing: PacingMetrics }).partial(),
  /** Which fix pass this is: 0 = first verify, 1..3 = after fix passes. */
  fix_pass: z.number().int().min(0).max(3),
  summary: Summary,
});
export type VerifyResponse = z.infer<typeof VerifyResponse>;

/**
 * Auto-fix loop contract (VER-2): the orchestrator returns findings to the
 * caller (model or style engine) and allows up to three fix passes. This
 * envelope is what both the MCP orchestrator and the style autopilot consume.
 */
export const VerifyFixLoopRequest = z.object({
  project_id: ProjectId,
  /** Pass 1: model applies fixes. Pass 2..3: orchestrator applies auto-fixes. */
  max_passes: z.number().int().min(1).max(3).default(3),
});
export type VerifyFixLoopRequest = z.infer<typeof VerifyFixLoopRequest>;

export const VerifyFixLoopResponse = z.object({
  project_id: ProjectId,
  passes: z.array(VerifyResponse),
  resolved: z.boolean(),
  summary: Summary,
});
export type VerifyFixLoopResponse = z.infer<typeof VerifyFixLoopResponse>;
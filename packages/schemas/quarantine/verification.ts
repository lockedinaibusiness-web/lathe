import { z } from "zod";
import { ProjectId, ClipId, CaptionItemId, TrackId, VerifyRunId } from "./ids.js";
import { Ms } from "./time.js";
import { Severity } from "./common.js";
import { TimelineVersionInfo } from "./timeline.js";
import { ErrorCode } from "./errors.js";

/** Codes for the automated quality checks (VER-1). One fixture per code in M5. */
export const VerifyCheckCode = z.enum([
  "MID_WORD_CUT",
  "AUDIO_CLICK",
  "AUDIO_CLIPPING",
  "LOUDNESS_OFF_TARGET",
  "TRUE_PEAK_EXCEEDED",
  "CAPTION_OVERFLOW",
  "CAPTION_READABILITY",
  "BLACK_FRAMES",
  "AV_DRIFT",
  "LEVEL_JUMP",
]);
export type VerifyCheckCode = z.infer<typeof VerifyCheckCode>;

export const Finding = z
  .object({
    code: VerifyCheckCode,
    severity: Severity,
    location: z
      .object({
        clip_ids: z.array(ClipId).max(50).optional(),
        caption_ids: z.array(CaptionItemId).max(50).optional(),
        track_id: TrackId.optional(),
        time_ms: Ms.optional(),
      })
      .describe("Where the finding applies, in stable IDs."),
    message: z.string().min(1).max(500),
    suggested_fix: z.string().min(1).max(1000).describe("Actionable fix a model can apply as operations."),
    metrics: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  })
  .describe("One verification finding (VER-2).");

export const Thresholds = z
  .object({
    loudness_tolerance_lu: z.number().min(0.1).max(3).default(1),
    true_peak_dbtp: z.number().min(-9).max(0).default(-1),
    black_frame_max: z.number().int().min(1).max(100).default(2),
    av_drift_ms: z.number().int().min(10).max(500).default(40),
    level_jump_db: z.number().min(1).max(20).default(6),
    caption_max_cps: z.number().min(5).max(30).default(17),
    caption_max_lines: z.number().int().min(1).max(3).default(2),
    caption_max_chars_per_line: z.number().int().min(10).max(60).default(42),
  })
  .describe("Initial verification thresholds (tunable per project later).");

export const VerifyRequest = z
  .object({
    project_id: ProjectId,
    base_version: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Verify this version; default = current timeline version."),
    checks: z.array(VerifyCheckCode).optional().describe("Run a subset; default all checks."),
    thresholds: Thresholds.partial().optional().describe("Override specific thresholds."),
  })
  .strict()
  .describe("Run automated quality checks on a timeline state.");

export const VerifyReport = z
  .object({
    run_id: VerifyRunId,
    project_id: ProjectId,
    version: TimelineVersionInfo,
    passed: z.boolean().describe("True when no finding has severity 'error'."),
    findings: z.array(Finding),
    stats: z.object({
      duration_ms: z.number().int().nonnegative(),
      checks_run: z.array(VerifyCheckCode),
    }),
  })
  .describe("Result of a verification run.");

/** A corrective pass driven by verify findings; orchestrator allows max 3 (VER-2). */
export const FixPassPolicy = z
  .object({
    max_passes: z.number().int().min(0).max(3).default(3),
    actor: z.enum(["model", "deterministic"]).default("deterministic"),
  })
  .describe("Auto fix-loop policy for verification failures.");

export const VerifyErrorShim = z
  .object({ kind: z.literal("verify_error"), code: ErrorCode })
  .describe("Internal marker so verify failures can surface through the standard error envelope.");

/**
 * Time references and cut snapping (invariants #1 and #6).
 *
 * Operations never carry free-typed timestamps as their primary addressing
 * mechanism. A raw timecode is accepted ONLY when the engine can snap it to a
 * word or frame boundary, and the apply response always reports the snap
 * (requested value, applied value, what it snapped to, and the delta).
 */

import { z } from "zod";
import type { ClipId, SegmentId } from "./ids.js";
import { ClipId as ClipIdSchema, SegmentId as SegmentIdSchema } from "./ids.js";

/** Edge selector for time references expressed relative to a clip. */
export const ClipEdge = z.enum(["in", "out"]);
export type ClipEdge = z.infer<typeof ClipEdge>;

/**
 * A time the caller wants to act on. Preferred kinds reference stable IDs:
 * - `word`: a word boundary inside a transcript segment (best for speech cuts)
 * - `clip`: an edge of a known clip, plus an offset
 * - `frame`: a frame boundary (best for visual cuts, e.g. shot changes)
 * - `seconds`: a raw timecode; accepted only because the engine snaps it and
 *   reports the snap in the operation result (invariant #1).
 */
export const TimeSpec = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("word"),
    segment_id: SegmentIdSchema,
    word_index: z.number().int().nonnegative(),
    edge: z.enum(["start", "end"]).default("start"),
  }),
  z.object({
    kind: z.literal("clip"),
    clip_id: ClipIdSchema,
    edge: ClipEdge,
    offset_s: z.number().finite().default(0),
  }),
  z.object({
    kind: z.literal("frame"),
    frame: z.number().int().nonnegative(),
    /** Source frame rate; used to resolve the frame to seconds. */
    fps: z.number().positive().finite().optional(),
  }),
  z.object({
    kind: z.literal("seconds"),
    seconds: z.number().nonnegative().finite(),
  }),
]);
export type TimeSpec = z.infer<typeof TimeSpec>;

/** What a resolved cut snapped to. `none` means the value was already exact. */
export const SnapTargetKind = z.enum(["word", "frame", "silence", "shot", "beat", "none"]);
export type SnapTargetKind = z.infer<typeof SnapTargetKind>;

/**
 * Snap report: the contract that makes raw timecodes safe. Returned for every
 * operation whose target resolved through a TimeSpec.
 */
export const SnapReport = z.object({
  op_id: z.string().min(1),
  /** The TimeSpec as requested. */
  requested: TimeSpec,
  /** Seconds the request resolved to before snapping. */
  resolved_s: z.number().nonnegative().finite(),
  /** Seconds actually applied after snapping. */
  applied_s: z.number().nonnegative().finite(),
  snapped_to: SnapTargetKind,
  /** Absolute distance between resolved_s and applied_s, in milliseconds. */
  delta_ms: z.number().nonnegative().finite(),
  /** Tolerance in effect for this operation. */
  tolerance_ms: z.number().nonnegative().finite(),
  /** Word index snapped to, when snapped_to is "word". */
  word: z
    .object({ segment_id: SegmentIdSchema, word_index: z.number().int().nonnegative() })
    .optional(),
});
export type SnapReport = z.infer<typeof SnapReport>;

/**
 * Default snapping policy shared by every tool and by the core engine.
 * Cuts prefer silence gaps and never land mid-word; tolerance is configurable.
 */
export const SnapPolicy = z.object({
  /** Never place a cut inside a word: snap outward to the nearest word edge. */
  avoid_mid_word: z.boolean().default(true),
  /** Prefer the middle of a detected silence/pause near the requested point. */
  prefer_silence: z.boolean().default(true),
  /** How far the applied point may move from the requested point. */
  tolerance_ms: z.number().nonnegative().finite().default(40),
  /** Max milliseconds inside the pause the cut may land. */
  pause_inset_ms: z.number().nonnegative().finite().default(40),
});
export type SnapPolicy = z.infer<typeof SnapPolicy>;
export const DEFAULT_SNAP_POLICY: SnapPolicy = {
  avoid_mid_word: true,
  prefer_silence: true,
  tolerance_ms: 40,
  pause_inset_ms: 40,
};

/** Plain seconds helper for building TimeSpecs. */
export function seconds(v: number): TimeSpec {
  return { kind: "seconds", seconds: v };
}

/** Word-boundary helper. */
export function wordTime(segmentId: SegmentId, wordIndex: number, edge: "start" | "end" = "start"): TimeSpec {
  return { kind: "word", segment_id: segmentId, word_index: wordIndex, edge };
}

/** Clip-edge helper. */
export function clipTime(clipId: ClipId, edge: ClipEdge, offsetS = 0): TimeSpec {
  return { kind: "clip", clip_id: clipId, edge, offset_s: offsetS };
}
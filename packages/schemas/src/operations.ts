/**
 * Timeline operations contract (EDT-2..EDT-7, invariants #1-#5, #10).
 *
 * The full declarative edit vocabulary. Every operation is:
 *  - addressed by stable IDs (targets), never free-typed timestamps,
 *  - invertible (core computes the inverse; the schema records the contract),
 *  - grouped (group_id) so a batch is one undoable, rationale-carrying unit,
 *  - rationaled: a one-line "why" stored with the group, shown in review.
 *
 * `apply_edits` applies up to 500 operations atomically (invariant #3).
 */

import { z } from "zod";
import {
  BatchId,
  CaptionId,
  ClipId,
  GroupId,
  OperationId,
  ProjectId,
  SegmentId,
  StyleId,
  TrackId,
} from "./ids.js";
import { Summary } from "./common.js";
import { SnapPolicy, TimeSpec } from "./time.js";

// ---------------------------------------------------------------------------
// Shared target helpers
// ---------------------------------------------------------------------------

/** A clip target. Most visual/cut operations act on exactly one clip. */
const ClipTarget = z.object({ clip_id: ClipId });

/** Audio operations act on a clip or a whole track. */
const AudioTarget = z.union([z.object({ clip_id: ClipId }), z.object({ track_id: TrackId })]);

/** Normalization can also run project-wide. */
const NormalizeTarget = z.union([
  z.object({ scope: z.literal("project") }),
  z.object({ clip_id: ClipId }),
  z.object({ track_id: TrackId }),
]);

// ---------------------------------------------------------------------------
// Operation definitions (discriminated union on `type`)
// ---------------------------------------------------------------------------

const rationale = z
  .string()
  .min(1)
  .max(500)
  .describe("One-line reason for this change, stored with the group and shown in review.");

const SplitOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("split"),
  target: ClipTarget.extend({ at: TimeSpec }),
  params: z.object({
    /** Optional client-proposed ID for the newly created (right-hand) clip. */
    new_clip_id: ClipId.optional(),
    snap_policy: SnapPolicy.optional(),
  }),
});

const TrimOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("trim"),
  target: ClipTarget,
  params: z.object({
    side: z.enum(["in", "out", "both"]),
    in: TimeSpec.optional(),
    out: TimeSpec.optional(),
    /** Ripple downstream clips by default (invariant #5). */
    ripple: z.boolean().default(true),
    snap_policy: SnapPolicy.optional(),
  }),
});

const DeleteOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("delete"),
  target: ClipTarget,
  params: z.object({
    /** Ripple downstream clips by default (invariant #5). */
    ripple: z.boolean().default(true),
  }),
});

const RippleDeleteOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("ripple_delete"),
  target: ClipTarget,
  params: z.object({
    /** The explicit form of delete with ripple; core rejects ripple:false. */
    ripple: z.boolean().default(true),
  }),
});

const ReorderOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("reorder"),
  target: ClipTarget,
  params: z.object({
    to_index: z.number().int().nonnegative(),
    to_track_id: TrackId.optional(),
  }),
});

const SetSpeedOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("set_speed"),
  target: ClipTarget,
  params: z.object({
    speed: z.number().min(0.1).max(8),
    preserve_pitch: z.boolean().default(true),
    ramp_in_s: z.number().min(0).max(2).optional(),
    ramp_out_s: z.number().min(0).max(2).optional(),
  }),
});

const ReframeOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("reframe"),
  target: ClipTarget,
  params: z.object({
    aspect: z.enum(["16:9", "9:16", "1:1", "4:5", "4:3", "custom"]),
    custom_w: z.number().int().positive().optional(),
    custom_h: z.number().int().positive().optional(),
    mode: z.enum(["subject", "face", "center", "manual"]).default("subject"),
    /** Subject-tracking smoothing window in seconds. */
    smoothing_s: z.number().min(0).max(2).default(0.5),
    /** Normalized offsets for manual mode (-1..1 of the croppable margin). */
    offset_x: z.number().min(-1).max(1).optional(),
    offset_y: z.number().min(-1).max(1).optional(),
    zoom: z.number().min(1).max(2).default(1),
  }),
});

const ZoomOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("zoom"),
  target: ClipTarget,
  params: z.object({
    scale: z.number().min(1).max(2),
    anchor: z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }).optional(),
    from: TimeSpec.optional(),
    to: TimeSpec.optional(),
    ease: z.enum(["linear", "ease_in", "ease_out", "ease_in_out"]).default("ease_in_out"),
  }),
});

const TransitionType = z.enum([
  "crossfade",
  "dip_to_black",
  "dip_to_white",
  "wipe",
  "slide",
  "hard_cut",
]);

const AddTransitionOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("add_transition"),
  /** The incoming clip; the transition is placed at its in-point. */
  target: ClipTarget,
  params: z.object({
    kind: TransitionType,
    duration_s: z.number().min(0).max(5).default(0.5),
  }),
});

const AddCaptionOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("add_caption"),
  target: ClipTarget,
  params: z.object({
    /** Text source: explicit text, or a transcript segment to lift from. */
    text: z.string().min(1).max(1000),
    segment_id: SegmentId.optional(),
    from: TimeSpec.optional(),
    to: TimeSpec.optional(),
    style_id: StyleId.optional(),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
    max_chars_per_line: z.number().int().min(8).max(64).optional(),
  }),
});

const StyleCaptionOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("style_caption"),
  target: z.object({ caption_id: CaptionId }),
  params: z.object({
    style_id: StyleId.optional(),
    overrides: z
      .object({
        font_family: z.string().max(64).optional(),
        font_size_pct: z.number().min(1).max(20).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        background_opacity: z.number().min(0).max(1).optional(),
        position: z.enum(["top", "center", "bottom"]).optional(),
        highlight: z.enum(["none", "word", "karaoke"]).optional(),
        max_lines: z.number().int().min(1).max(4).optional(),
      })
      .optional(),
  }),
});

const AddOverlayOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("add_overlay"),
  target: ClipTarget,
  params: z.object({
    kind: z.enum(["image", "video", "logo", "lower_third", "progress_bar", "text"]),
    /** Project asset to overlay (required for image/video/logo). */
    asset_id: z.string().regex(/^ast_[A-Za-z0-9]{10,64}$/).optional(),
    text: z.string().max(300).optional(),
    from: TimeSpec,
    to: TimeSpec,
    position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
    scale: z.number().min(0.05).max(2).optional(),
    opacity: z.number().min(0).max(1).default(1),
  }),
});

const SetGainOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("set_gain"),
  target: AudioTarget,
  params: z.object({ gain_db: z.number().min(-60).max(24) }),
});

const DuckAudioOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("duck_audio"),
  target: AudioTarget,
  params: z.object({
    duck_db: z.number().min(-60).max(0),
    under: z.enum(["speech", "music", "all"]).default("speech"),
    fade_s: z.number().min(0).max(2).default(0.3),
    range: z.object({ from: TimeSpec, to: TimeSpec }).optional(),
  }),
});

const NormalizeAudioOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("normalize_audio"),
  target: NormalizeTarget,
  params: z.object({
    target_lufs: z.number().min(-40).max(-5),
    true_peak_dbtp: z.number().min(-6).max(-0.3),
  }),
});

const BrollSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project_asset"),
    asset_id: z.string().regex(/^ast_[A-Za-z0-9]{10,64}$/),
    in_s: z.number().nonnegative().optional(),
    out_s: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("project_search"),
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  z.object({
    kind: z.literal("stock"),
    provider: z.string().min(1).max(32),
    query: z.string().min(1).max(200),
  }),
]);

const InsertBrollOp = z.object({
  id: OperationId,
  group_id: GroupId,
  rationale,
  type: z.literal("insert_broll"),
  target: ClipTarget.extend({ at: TimeSpec }),
  params: z.object({
    source: BrollSource,
    /** Duration of the B-roll insert in seconds. */
    duration_s: z.number().min(0.2).max(120),
    audio: z.enum(["mute", "keep", "duck"]).default("duck"),
  }),
});

export const Operation = z.discriminatedUnion("type", [
  SplitOp,
  TrimOp,
  DeleteOp,
  RippleDeleteOp,
  ReorderOp,
  SetSpeedOp,
  ReframeOp,
  ZoomOp,
  AddTransitionOp,
  AddCaptionOp,
  StyleCaptionOp,
  AddOverlayOp,
  SetGainOp,
  DuckAudioOp,
  NormalizeAudioOp,
  InsertBrollOp,
]);
export type Operation = z.infer<typeof Operation>;
export type OperationType = Operation["type"];

// ---------------------------------------------------------------------------
// Operation metadata registry
// ---------------------------------------------------------------------------

export const OperationCategory = z.enum([
  "cut",
  "arrange",
  "visual",
  "transition",
  "caption",
  "audio",
  "insert",
]);

/**
 * Static facts about each operation kind. The core engine (M1) uses this to
 * route validation, inverse computation, and render planning; tests assert it
 * stays in sync with the union above.
 */
export const OperationMeta = z.object({
  type: z.string(),
  category: OperationCategory,
  description: z.string().min(1),
  /** Every operation in Lathe is invertible (invariant #2). */
  invertible: z.literal(true),
  /** True if applying changes the timeline duration (needs ripple handling). */
  affects_duration: z.boolean(),
  /** Which streams the renderer must re-encode because of this op. */
  affects_streams: z.enum(["none", "video", "audio", "both"]),
});
export type OperationMeta = z.infer<typeof OperationMeta>;

export const OPERATION_META: Record<OperationType, OperationMeta> = {
  split: {
    type: "split",
    category: "cut",
    description: "Split a clip into two adjacent clips at a word/frame-aligned point.",
    invertible: true,
    affects_duration: false,
    affects_streams: "none",
  },
  trim: {
    type: "trim",
    category: "cut",
    description: "Move a clip's in or out point; ripples downstream clips by default.",
    invertible: true,
    affects_duration: true,
    affects_streams: "both",
  },
  delete: {
    type: "delete",
    category: "cut",
    description: "Remove a clip; ripples downstream clips unless ripple is false.",
    invertible: true,
    affects_duration: true,
    affects_streams: "none",
  },
  ripple_delete: {
    type: "ripple_delete",
    category: "cut",
    description: "Explicit ripple delete: remove a clip and close the gap downstream.",
    invertible: true,
    affects_duration: true,
    affects_streams: "none",
  },
  reorder: {
    type: "reorder",
    category: "arrange",
    description: "Move a clip to another index, optionally on another track.",
    invertible: true,
    affects_duration: false,
    affects_streams: "none",
  },
  set_speed: {
    type: "set_speed",
    category: "visual",
    description: "Change clip playback speed (0.1x-8x) with optional pitch preservation.",
    invertible: true,
    affects_duration: true,
    affects_streams: "both",
  },
  reframe: {
    type: "reframe",
    category: "visual",
    description: "Reframe to another aspect ratio with subject tracking and smoothing.",
    invertible: true,
    affects_duration: false,
    affects_streams: "video",
  },
  zoom: {
    type: "zoom",
    category: "visual",
    description: "Punch-in zoom over a range with easing and optional anchor.",
    invertible: true,
    affects_duration: false,
    affects_streams: "video",
  },
  add_transition: {
    type: "add_transition",
    category: "transition",
    description: "Add a transition at a clip's in-point (crossfade, dip, wipe, ...).",
    invertible: true,
    affects_duration: false,
    affects_streams: "both",
  },
  add_caption: {
    type: "add_caption",
    category: "caption",
    description: "Add a caption from explicit text or a transcript segment.",
    invertible: true,
    affects_duration: false,
    affects_streams: "video",
  },
  style_caption: {
    type: "style_caption",
    category: "caption",
    description: "Restyle an existing caption or override individual fields.",
    invertible: true,
    affects_duration: false,
    affects_streams: "video",
  },
  add_overlay: {
    type: "add_overlay",
    category: "insert",
    description: "Overlay an image, video, logo, lower-third, or progress bar over a range.",
    invertible: true,
    affects_duration: false,
    affects_streams: "video",
  },
  set_gain: {
    type: "set_gain",
    category: "audio",
    description: "Apply a fixed gain (dB) to a clip or track.",
    invertible: true,
    affects_duration: false,
    affects_streams: "audio",
  },
  duck_audio: {
    type: "duck_audio",
    category: "audio",
    description: "Duck a clip/track under speech (or music) with fades.",
    invertible: true,
    affects_duration: false,
    affects_streams: "audio",
  },
  normalize_audio: {
    type: "normalize_audio",
    category: "audio",
    description: "Normalize loudness to a target with a true-peak ceiling.",
    invertible: true,
    affects_duration: false,
    affects_streams: "audio",
  },
  insert_broll: {
    type: "insert_broll",
    category: "insert",
    description: "Insert B-roll over the main clip at a time point.",
    invertible: true,
    affects_duration: false,
    affects_streams: "both",
  },
};

// ---------------------------------------------------------------------------
// apply_edits / undo / redo contracts (EDT-4, EDT-6, invariants #3, #4)
// ---------------------------------------------------------------------------

/** Maximum operations per batch (invariant #3 / EDT-4). */
export const MAX_BATCH_OPS = 500;

export const ApplyEditsRequest = z.object({
  project_id: ProjectId,
  /** Optimistic concurrency: the timeline version this batch was planned against. */
  base_version: z.number().int().nonnegative(),
  operations: z.array(Operation).min(1).max(MAX_BATCH_OPS),
  idempotency_key: z.string().min(8).max(128),
  /** When true, validate and simulate (with snap reports) but do not persist. */
  dry_run: z.boolean().default(false),
  /** Overrides the default snap tolerance for this batch. */
  default_snap_tolerance_ms: z.number().nonnegative().finite().optional(),
  actor: z.string().min(1).max(64).describe("Who is applying: user ID or model identifier"),
});
export type ApplyEditsRequest = z.infer<typeof ApplyEditsRequest>;

export const OperationResult = z.object({
  op_id: OperationId,
  ok: z.boolean(),
  /** Snap reports for every TimeSpec this operation resolved. */
  snap: z.array(z.unknown()).optional(),
  /** IDs created by the operation (split clip, caption, ...). */
  created: z
    .object({
      clip_ids: z.array(ClipId).optional(),
      caption_ids: z.array(CaptionId).optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      suggested_fix: z.string(),
      field: z.string().optional(),
    })
    .optional(),
});
export type OperationResult = z.infer<typeof OperationResult>;

export const BatchConflict = z.object({
  code: z.string(),
  op_ids: z.array(OperationId).min(1),
  message: z.string(),
  suggested_fix: z.string(),
});
export type BatchConflict = z.infer<typeof BatchConflict>;

export const ApplyEditsResponse = z.object({
  batch_id: BatchId,
  project_id: ProjectId,
  previous_version: z.number().int().nonnegative(),
  new_version: z.number().int().nonnegative(),
  /** false when dry_run, or when the batch was rejected. */
  applied: z.boolean(),
  results: z.array(OperationResult),
  conflicts: z.array(BatchConflict),
  summary: Summary,
});
export type ApplyEditsResponse = z.infer<typeof ApplyEditsResponse>;

export const UndoRedoTarget = z.union([
  z.object({ kind: z.literal("group"), group_id: GroupId }),
  z.object({ kind: z.literal("batch"), batch_id: BatchId }),
  z.object({ kind: z.literal("last"), count: z.number().int().min(1).max(20).default(1) }),
]);

export const UndoRedoRequest = z.object({
  project_id: ProjectId,
  idempotency_key: z.string().min(8).max(128),
  target: UndoRedoTarget,
  expected_version: z.number().int().nonnegative().optional(),
});
export type UndoRedoRequest = z.infer<typeof UndoRedoRequest>;

export const UndoRedoResponse = z.object({
  ok: z.boolean(),
  reverted_op_ids: z.array(OperationId),
  group_id: GroupId.optional(),
  batch_id: BatchId.optional(),
  new_version: z.number().int().nonnegative(),
  summary: Summary,
});
export type UndoRedoResponse = z.infer<typeof UndoRedoResponse>;

/** The operation types listed in EDT-2, exported for docs/tests. */
export const OPERATION_TYPES = [
  "split",
  "trim",
  "delete",
  "ripple_delete",
  "reorder",
  "set_speed",
  "reframe",
  "zoom",
  "add_transition",
  "add_caption",
  "style_caption",
  "add_overlay",
  "set_gain",
  "duck_audio",
  "normalize_audio",
  "insert_broll",
] as const satisfies readonly OperationType[];
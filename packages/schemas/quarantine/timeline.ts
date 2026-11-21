import { z } from "zod";
import { ClipId, TrackId, TransitionId, CaptionItemId, StyleId, AssetId } from "./ids.js";
import { Ms, Speed, UnitInterval } from "./time.js";
import { Sha256Hex } from "./common.js";

/** A timeline track. Caption tracks hold caption items instead of clips. */
export const TrackKind = z.enum(["video", "audio", "caption"]);

export const Track = z
  .object({
    id: TrackId,
    kind: TrackKind,
    name: z.string().min(1).max(80),
    position: z.number().int().min(0).describe("Order within the same kind. 0 is the topmost/first track."),
    locked: z.boolean().optional().describe("Locked tracks reject operations in core validation."),
  })
  .describe("A timeline track.");

/** Aspect ratio for reframe operations. */
export const Aspect = z.enum(["16:9", "9:16", "1:1", "4:5"]);

export const NormalizedPoint = z.object({
  x: UnitInterval.describe("Horizontal position, 0 = left edge, 1 = right edge."),
  y: UnitInterval.describe("Vertical position, 0 = top edge, 1 = bottom edge."),
});

export const ReframeSpec = z
  .object({
    aspect: Aspect,
    mode: z
      .enum(["center", "fixed", "track"])
      .describe("center = crop centered; fixed = crop at fixed_center; track = follow detected subject."),
    fixed_center: NormalizedPoint.optional(),
    smoothing_ms: z
      .number()
      .int()
      .min(0)
      .max(2000)
      .default(300)
      .describe("Smoothing window for subject-tracking movement."),
  })
  .describe("Reframe (aspect change) applied to a clip.");

export const ZoomKeyframe = z
  .object({
    t_ms: Ms.describe("Time relative to the clip's timeline start."),
    scale: z.number().min(1).max(3).describe("Zoom factor, 1 = no zoom."),
    center: NormalizedPoint.optional().describe("Zoom focus point in normalized source coordinates."),
  })
  .describe("One zoom keyframe.");

export const ZoomSpec = z
  .object({
    keyframes: z.array(ZoomKeyframe).min(1),
    easing: z.enum(["linear", "ease_in_out"]).default("linear"),
  })
  .describe("Punch-in / Ken Burns zoom applied to a clip.");

export const Clip = z
  .object({
    id: ClipId,
    track_id: TrackId,
    asset_id: AssetId,
    source_in_ms: Ms.describe("Start offset inside the source asset."),
    source_out_ms: Ms.describe("End offset inside the source asset (exclusive)."),
    timeline_start_ms: Ms.describe("Start position on the timeline."),
    speed: Speed.default(1),
    gain_db: z.number().min(-60).max(12).optional(),
    opacity: z.number().min(0).max(1).optional(),
    reframe: ReframeSpec.optional(),
    zoom: ZoomSpec.optional(),
  })
  .refine((c) => c.source_out_ms > c.source_in_ms, {
    message: "source_out_ms must be greater than source_in_ms",
  })
  .describe(
    "A clip: a reference to a span of a source asset placed on a track. Timeline duration = (source_out_ms - source_in_ms) / speed.",
  );

export const TransitionKind = z.enum([
  "crossfade",
  "dip_to_black",
  "dip_to_white",
  "wipe_left",
  "wipe_right",
  "slide_up",
  "slide_down",
]);

export const Transition = z
  .object({
    id: TransitionId,
    a_clip_id: ClipId.describe("Outgoing clip."),
    b_clip_id: ClipId.describe("Incoming clip; must be adjacent to a_clip_id on the same track."),
    kind: TransitionKind,
    duration_ms: z.number().int().min(40).max(5000),
  })
  .describe("A transition bridging two adjacent clips on the same track.");

export const CaptionWord = z.object({
  w: z.string().min(1).max(40).describe("The word text."),
  s: Ms,
  e: Ms,
  c: UnitInterval.optional().describe("Recognition confidence 0..1."),
});

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

export const CaptionStylePatch = z
  .object({
    font_family: z.string().min(1).max(80).optional(),
    size_px: z.number().int().min(8).max(400).optional(),
    color: HexColor.optional(),
    background_color: HexColor.nullable().optional(),
    outline_color: HexColor.optional(),
    outline_width_px: z.number().min(0).max(20).optional(),
    position: z.enum(["bottom", "top", "center"]).optional(),
    margin_px: z.number().min(0).max(500).optional(),
    max_lines: z.number().int().min(1).max(3).optional(),
    max_chars_per_line: z.number().int().min(1).max(60).optional(),
    max_cps: z.number().min(1).max(30).optional().describe("Max characters per second (reading speed)."),
  })
  .describe("Partial caption style; only provided keys change.");

export const CaptionItem = z
  .object({
    id: CaptionItemId,
    track_id: TrackId.describe("A track with kind 'caption'."),
    start_ms: Ms,
    end_ms: Ms,
    text: z.string().min(1).max(500),
    words: z.array(CaptionWord).optional().describe("Word timings for karaoke/highlight captions."),
    style_id: StyleId.optional(),
  })
  .refine((c) => c.end_ms > c.start_ms, { message: "end_ms must be greater than start_ms" })
  .describe("A caption cue on a caption track.");

export const Timeline = z
  .object({
    tracks: z.array(Track).min(1),
    clips: z.array(Clip),
    transitions: z.array(Transition).default([]),
    caption_items: z.array(CaptionItem).default([]),
  })
  .describe(
    "The declarative timeline. Rendering is a pure function of (timeline, source media hashes, preset) — Invariant 7.",
  );

export const TimelineVersionInfo = z
  .object({
    version: z.number().int().min(1).describe("Monotonic timeline version; increments on every applied group."),
    hash: Sha256Hex.describe("SHA-256 of the canonical timeline JSON — part of the render cache key."),
  })
  .describe("Identity of one timeline state.");

export type Timeline = z.infer<typeof Timeline>;
export type Clip = z.infer<typeof Clip>;
export type Track = z.infer<typeof Track>;
export type CaptionItem = z.infer<typeof CaptionItem>;

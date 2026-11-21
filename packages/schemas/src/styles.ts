/**
 * Edit style recipes (STY-1, STY-2).
 *
 * Styles are DATA (validated here, stored as JSON in /styles), never hardcoded
 * logic. The five launch styles ship as data files validated by this schema in
 * M7; the schema itself is a Milestone 0 contract so `list_styles` and
 * `plan_edit` are fully specified now.
 */

import { z } from "zod";
import { StyleId } from "./ids.js";

export const PacingRules = z.object({
  /** Pauses longer than this get trimmed down to target_pause_s. */
  max_pause_s: z.number().positive().finite(),
  /** What the pause is reduced to (keep some air for rhythm). */
  target_pause_s: z.number().positive().finite(),
  /** Filler words removed by remove_fillers (lowercase). */
  filler_words: z.array(z.string().min(1).max(40)),
  /** Max gap (ms) between filler words to treat as one cluster. */
  filler_cluster_gap_ms: z.number().int().nonnegative(),
  /** Remove stutter/false starts (restarted sentences). */
  remove_false_starts: z.boolean(),
  /** Repeated takes: keep the last complete take, drop earlier attempts. */
  repeated_takes: z.enum(["keep_last", "keep_first", "keep_all"]),
  /** Keep short breaths (natural rhythm) at least this long. */
  keep_breaths_min_s: z.number().min(0).finite().default(0.12),
});
export type PacingRules = z.infer<typeof PacingRules>;

export const CaptionRules = z.object({
  enabled: z.boolean(),
  style_id: StyleId.optional(),
  max_lines: z.number().int().min(1).max(4),
  max_chars_per_line: z.number().int().min(8).max(64),
  /** Reading-speed cap in characters per second. */
  max_cps: z.number().positive().finite(),
  highlight: z.enum(["none", "word", "karaoke"]).default("none"),
});
export type CaptionRules = z.infer<typeof CaptionRules>;

export const ZoomRules = z.object({
  enabled: z.boolean(),
  min_scale: z.number().min(1).max(2),
  max_scale: z.number().min(1).max(2),
  /** Punch-in every N..M seconds. */
  interval_min_s: z.number().positive().finite(),
  interval_max_s: z.number().positive().finite(),
  smoothing_s: z.number().min(0).max(2).default(0.4),
  /** Zoom toward detected activity (screen recordings). */
  follow_activity: z.boolean().default(false),
});
export type ZoomRules = z.infer<typeof ZoomRules>;

export const AudioRules = z.object({
  target_lufs: z.number().min(-40).max(-5),
  true_peak_dbtp: z.number().min(-6).max(-0.3),
  duck_music_db: z.number().min(-60).max(0).default(-12),
  denoise: z.boolean().default(false),
});
export type AudioRules = z.infer<typeof AudioRules>;

export const SpeedRules = z.object({
  enabled: z.boolean(),
  max_speed: z.number().min(1).max(4).default(2),
  /** Idle threshold: stretches with no activity longer than this get sped up. */
  idle_threshold_s: z.number().positive().finite().default(1.5),
  /** Show a visible speed indicator when speeding up. */
  show_indicator: z.boolean().default(true),
});
export type SpeedRules = z.infer<typeof SpeedRules>;

export const HookRules = z.object({
  /** Target the strongest hook inside the first N seconds. */
  window_s: z.number().positive().finite().default(3),
  keep_longest_hook: z.boolean().default(true),
});
export type HookRules = z.infer<typeof HookRules>;

export const LengthRules = z.object({
  target_s: z.number().positive().finite().optional(),
  min_s: z.number().positive().finite().optional(),
  max_s: z.number().positive().finite().optional(),
});
export type LengthRules = z.infer<typeof LengthRules>;

export const StyleRecipe = z.object({
  id: StyleId,
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(500),
  /** Content types this style is designed for. */
  targets: z.array(z.enum(["podcast", "interview", "talking_head", "tutorial", "screen", "short_form", "highlight_reel"])).min(1),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]).default("16:9"),
  length: LengthRules.optional(),
  pacing: PacingRules,
  captions: CaptionRules,
  zoom: ZoomRules.optional(),
  audio: AudioRules,
  speed: SpeedRules.optional(),
  hooks: HookRules.optional(),
  /** Transition used between kept segments after filler/silence removal. */
  default_transition: z.enum(["hard_cut", "crossfade"]).default("hard_cut"),
});
export type StyleRecipe = z.infer<typeof StyleRecipe>;

/** list_styles response. */
export const ListStylesResponse = z.object({
  styles: z.array(StyleRecipe),
  /** Caption presets referenced by the styles, resolved for the model. */
  caption_styles: z.array(
    z.object({
      id: StyleId,
      name: z.string(),
      font_family: z.string(),
      font_size_pct: z.number(),
      color: z.string(),
      highlight: z.enum(["none", "word", "karaoke"]),
      position: z.enum(["top", "center", "bottom"]),
      max_lines: z.number().int(),
    }),
  ),
  summary: z.string().min(1).max(500),
});
export type ListStylesResponse = z.infer<typeof ListStylesResponse>;

/**
 * plan_edit response: a server-side planning template (PLG-2 recipe). The
 * model turns this + the Brief into an apply_edits batch; the recipe keeps
 * quality consistent regardless of which model runs.
 */
export const PlanEditRequest = z.object({
  project_id: z.string().min(1),
  goal: z.enum([
    "cleanup",            // podcast cleanup
    "tighten",            // talking head pacing
    "tutorial_polish",
    "short_form_clip",
    "highlight_reel",
    "custom",
  ]),
  style_id: StyleId.optional(),
  /** Free-form user instruction (untrusted-ish: kept out of tool schemas). */
  instruction: z.string().max(2000).optional(),
  target_length_s: z.number().positive().finite().optional(),
  clips: z.number().int().min(1).max(50).optional().describe("For clip extraction goals"),
});
export type PlanEditRequest = z.infer<typeof PlanEditRequest>;

export const PlanEditResponse = z.object({
  project_id: z.string(),
  goal: z.string(),
  style: StyleRecipe,
  /** Ordered application steps the model should execute. */
  steps: z.array(
    z.object({
      order: z.number().int().min(1),
      action: z.string().min(1).max(64),
      tool: z.string().min(1).max(64),
      params: z.record(z.string(), z.unknown()),
      rationale_template: z.string().min(1).max(300),
    }),
  ),
  /** Constraints the verify step will enforce. */
  constraints: z.record(z.string(), z.unknown()),
  summary: z.string().min(1).max(500),
});
export type PlanEditResponse = z.infer<typeof PlanEditResponse>;
/**
 * The Brief: the compact, model-readable description of a project (BRF-1..6,
 * invariant #9).
 *
 * The model never sees raw video. It sees this, plus explicitly requested
 * frames. Everything the model addresses (segments, shots, speakers) carries a
 * stable ID.
 */

import { z } from "zod";
import { DetailLevel, LanguageCode, SectionReadiness, Summary } from "./common.js";
import type { StyleId } from "./ids.js";
import { ProjectId, SegmentId, ShotId, SpeakerId } from "./ids.js";

/** One spoken word with timestamps and a 0..1 confidence. */
export const Word = z.object({
  w: z.string().min(1),
  s: z.number().nonnegative().finite(),
  e: z.number().nonnegative().finite(),
  c: z.number().min(0).max(1).describe("ASR confidence, 0..1"),
});
export type Word = z.infer<typeof Word>;

export const Speaker = z.object({
  id: SpeakerId,
  /** Human-facing label: "Speaker 1", "Host", ... (never user PII). */
  label: z.string().min(1).max(64),
  /** Share of total speech time, 0..1. */
  share: z.number().min(0).max(1).optional(),
});
export type Speaker = z.infer<typeof Speaker>;

export const Segment = z.object({
  id: SegmentId,
  start_s: z.number().nonnegative().finite(),
  end_s: z.number().nonnegative().finite(),
  speaker: SpeakerId,
  text: z.string(),
  words: z.array(Word).describe("Word-level timings; present once transcript is ready."),
  shot_id: ShotId.optional(),
  /** Optional editorial flags the indexer attaches. */
  tags: z.array(z.enum(["filler", "false_start", "repeat", "hook", "topic_start", "dead_air"])).optional(),
});
export type Segment = z.infer<typeof Segment>;

export const Shot = z.object({
  id: ShotId,
  start_s: z.number().nonnegative().finite(),
  end_s: z.number().nonnegative().finite(),
  description: z.string().max(300).optional(),
  faces: z.number().int().nonnegative().optional(),
  ocr: z.array(z.string().max(200)).optional(),
  /** Camera/screen activity markers for screen recordings. */
  activity: z.number().min(0).max(1).optional(),
});
export type Shot = z.infer<typeof Shot>;

export const Silence = z.object({
  s: z.number().nonnegative().finite(),
  e: z.number().nonnegative().finite(),
});
export type Silence = z.infer<typeof Silence>;

export const LoudnessPoint = z.object({
  t: z.number().nonnegative().finite(),
  lufs: z.number().finite(),
});
export type LoudnessPoint = z.infer<typeof LoudnessPoint>;

export const MusicRange = z.object({
  s: z.number().nonnegative().finite(),
  e: z.number().nonnegative().finite(),
  kind: z.enum(["music", "speech", "mixed", "silence"]),
});
export type MusicRange = z.infer<typeof MusicRange>;

export const AudioSection = z.object({
  silences: z.array(Silence),
  loudness_curve: z.array(LoudnessPoint),
  music_ranges: z.array(MusicRange),
  beats: z
    .array(z.object({ t: z.number().nonnegative().finite(), strength: z.number().min(0).max(1) }))
    .optional(),
});
export type AudioSection = z.infer<typeof AudioSection>;

export const EditorialHints = z.object({
  repeated_takes: z.array(
    z.object({
      segment_ids: z.array(SegmentId).min(2),
      /** Which take the indexer believes is the "good" one. */
      recommended: SegmentId,
      reason: z.string().max(200).optional(),
    }),
  ),
  filler_clusters: z.array(
    z.object({
      segment_ids: z.array(SegmentId).min(1),
      /** Total seconds removable if the cluster is cut. */
      removable_s: z.number().min(0).finite(),
    }),
  ),
  dead_air: z.array(
    z.object({
      s: z.number().nonnegative().finite(),
      e: z.number().nonnegative().finite(),
      suggested_action: z.enum(["cut", "speed_up", "keep"]),
    }),
  ),
  hook_candidates: z.array(
    z.object({
      segment_id: SegmentId,
      score: z.number().min(0).max(1),
      reason: z.string().max(200).optional(),
    }),
  ),
});
export type EditorialHints = z.infer<typeof EditorialHints>;

export const BriefReadiness = z.object({
  transcript: SectionReadiness,
  speakers: SectionReadiness,
  shots: SectionReadiness,
  audio: SectionReadiness,
  visual: SectionReadiness,
  embeddings: SectionReadiness,
});
export type BriefReadiness = z.infer<typeof BriefReadiness>;

export const Brief = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  project_id: ProjectId,
  duration_s: z.number().nonnegative().finite(),
  language: LanguageCode.optional(),
  detail: DetailLevel,
  readiness: BriefReadiness,
  speakers: z.array(Speaker),
  segments: z.array(Segment),
  shots: z.array(Shot),
  audio: AudioSection,
  hints: EditorialHints,
  /** Sections omitted at this detail level (for transparency). */
  omitted_sections: z.array(z.string()),
  /** Rough token estimate of the rendered text form. */
  token_estimate: z.number().int().nonnegative(),
  /** True when the model should call get_brief again to get more. */
  truncated: z.boolean(),
});
export type Brief = z.infer<typeof Brief>;

// ---------------------------------------------------------------------------
// Range queries and detail control (BRF-3)
// ---------------------------------------------------------------------------

export const BriefRange = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("segments"),
    ids: z.array(SegmentId).min(1).max(500),
  }),
  z.object({
    kind: z.literal("time"),
    start_s: z.number().nonnegative().finite(),
    end_s: z.number().nonnegative().finite(),
  }),
  z.object({
    kind: z.literal("speakers"),
    ids: z.array(SpeakerId).min(1).max(50),
  }),
  z.object({
    kind: z.literal("shots"),
    ids: z.array(ShotId).min(1).max(500),
  }),
]);
export type BriefRange = z.infer<typeof BriefRange>;

export const GetBriefRequest = z.object({
  project_id: ProjectId,
  detail: DetailLevel.default("standard"),
  range: BriefRange.optional(),
  /** Include editorial hints (cheap, computed by the indexer). */
  include_hints: z.boolean().default(true),
  /** Include word-level timings (drives token cost; off = segment text only). */
  include_words: z.boolean().default(true),
});
export type GetBriefRequest = z.infer<typeof GetBriefRequest>;

export const GetBriefResponse = z.object({
  brief: Brief,
  summary: Summary,
  /** Which sections were still pending when this Brief was assembled. */
  pending_sections: z.array(z.string()),
});
export type GetBriefResponse = z.infer<typeof GetBriefResponse>;

// ---------------------------------------------------------------------------
// Frames / contact sheets (BRF-6)
// ---------------------------------------------------------------------------

export const GetFramesRequest = z.object({
  project_id: ProjectId,
  /** Exactly one selector: segment IDs, shot IDs, or explicit times. */
  segment_ids: z.array(SegmentId).max(200).optional(),
  shot_ids: z.array(ShotId).max(100).optional(),
  /** Times in seconds; each is resolved to the nearest frame. */
  times_s: z.array(z.number().nonnegative().finite()).max(200).optional(),
  /** Max frames per target (contact sheet density). */
  per_target: z.number().int().min(1).max(20).default(3),
  width: z.number().int().min(64).max(1920).default(320),
  /** Return a single stacked contact sheet instead of individual frames. */
  contact_sheet: z.boolean().default(false),
});
export type GetFramesRequest = z.infer<typeof GetFramesRequest>;

export const Frame = z.object({
  /** Frame time in source seconds. */
  t: z.number().nonnegative().finite(),
  segment_id: SegmentId.optional(),
  shot_id: ShotId.optional(),
  /** Signed, expiring URL (never logged; short TTL). */
  url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Frame = z.infer<typeof Frame>;

export const GetFramesResponse = z.object({
  project_id: ProjectId,
  frames: z.array(Frame),
  contact_sheet_url: z.string().url().optional(),
  summary: Summary,
});
export type GetFramesResponse = z.infer<typeof GetFramesResponse>;

// ---------------------------------------------------------------------------
// search_footage (keyword-first, embeddings-second; P1 semantic)
// ---------------------------------------------------------------------------

export const SearchFootageRequest = z.object({
  project_id: ProjectId,
  query: z.string().min(1).max(500),
  mode: z.enum(["keyword", "semantic", "auto"]).default("auto"),
  limit: z.number().int().min(1).max(50).default(10),
  /** Restrict to a range (segment IDs or time window). */
  range: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("segments"), ids: z.array(SegmentId).min(1).max(500) }),
    z.object({
      kind: z.literal("time"),
      start_s: z.number().nonnegative().finite(),
      end_s: z.number().nonnegative().finite(),
    }),
  ]).optional(),
});
export type SearchFootageRequest = z.infer<typeof SearchFootageRequest>;

export const SearchHit = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("segment"),
    segment: Segment,
    score: z.number().min(0).max(1),
    matched_words: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("shot"),
    shot: Shot,
    score: z.number().min(0).max(1),
  }),
]);
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchFootageResponse = z.object({
  project_id: ProjectId,
  mode: z.enum(["keyword", "semantic"]),
  hits: z.array(SearchHit),
  summary: Summary,
  /** Present when semantic search was requested but the index is not ready. */
  notice: z.string().optional(),
});
export type SearchFootageResponse = z.infer<typeof SearchFootageResponse>;

/** Style reference re-exported for tools that take a style_id. */
export type { StyleId };
/**
 * The declarative timeline model (EDT-1).
 *
 * Pure data, zero I/O. Rendering is a pure function of
 * (timeline, source media hashes, preset) - invariant #7 - so the whole model
 * lives here as plain structured values.
 *
 * Coordinate systems:
 *  - Clips reference SOURCE media seconds via [source_in_s, source_out_s].
 *  - Clips live on the timeline at [start_s, start_s + duration) where
 *    duration = (source_out_s - source_in_s) / speed.
 *  - Captions carry ABSOLUTE timeline seconds and attach to a clip.
 *
 * Ripple semantics (invariant #5): operations that change a clip's extent
 * shift every later clip on the same track by the same delta unless the
 * operation opts out with ripple: false.
 */

import { generateId } from "@lathe/schemas";

export type TrackKind = "video" | "audio" | "caption";
export type Aspect = "16:9" | "9:16" | "1:1" | "4:5" | "4:3" | "custom";
export type ReframeMode = "subject" | "face" | "center" | "manual";
export type ZoomEase = "linear" | "ease_in" | "ease_out" | "ease_in_out";

export interface Reframe {
  aspect: Aspect;
  custom_w?: number;
  custom_h?: number;
  mode: ReframeMode;
  smoothing_s: number;
  offset_x?: number;
  offset_y?: number;
  zoom: number;
}

export interface Zoom {
  scale: number;
  anchor?: { x: number; y: number };
  from_s?: number;
  to_s?: number;
  ease: ZoomEase;
}

/** null means "no transition" (a hard cut). */
export type Transition = { kind: string; duration_s: number } | null;

export interface ClipAudio {
  gain_db?: number;
  duck?: { duck_db: number; under: "speech" | "music" | "all"; fade_s: number; range?: { from_s: number; to_s: number } };
  normalize?: { target_lufs: number; true_peak_dbtp: number };
}

export interface Overlay {
  id: string;
  kind: "image" | "video" | "logo" | "lower_third" | "progress_bar" | "text";
  asset_id?: string;
  text?: string;
  from_s: number;
  to_s: number;
  position?: { x: number; y: number };
  scale?: number;
  opacity: number;
}

export interface Clip {
  id: string;
  track_id: string;
  /** The source segment this clip's media comes from. */
  segment_id: string;
  start_s: number;
  source_in_s: number;
  source_out_s: number;
  speed: number;
  /** Explicit null (not missing) when unset: inverses restore exactly. */
  reframe: Reframe | null;
  zoom: Zoom | null;
  transition: Transition;
  audio: ClipAudio | null;
  overlays: Overlay[];
  /** For B-roll clips: how the underlying audio behaves. */
  broll_audio?: "mute" | "keep" | "duck";
  /** True for engine-created B-roll overlay clips. */
  is_broll?: boolean;
}

export interface Caption {
  id: string;
  track_id: string;
  clip_id: string;
  start_s: number;
  end_s: number;
  text: string;
  style_id?: string;
  speaker?: string;
  language?: string;
  overrides?: Record<string, unknown>;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  position: number;
  locked?: boolean;
  /** Track-level audio settings (project-scope ops deny this). */
  audio: ClipAudio | null;
  /** Clip IDs in timeline order on this track. */
  clip_ids: string[];
}

export interface Timeline {
  version: number;
  tracks: Track[];
  clips: Record<string, Clip>;
  captions: Record<string, Caption>;
  /** Project-scope audio settings (normalize_audio target: project). */
  audio: ClipAudio | null;
}

// ---------------------------------------------------------------------------
// Construction and basic queries
// ---------------------------------------------------------------------------

/** Timeline duration in seconds (longest clip end across tracks). */
export function timelineDuration(t: Timeline): number {
  let max = 0;
  for (const id of Object.keys(t.clips)) {
    max = Math.max(max, clipEnd(t.clips[id]!));
  }
  return max;
}

/** Source-media length a clip consumes. */
export function clipSourceLength(c: Clip): number {
  return c.source_out_s - c.source_in_s;
}

/** Timeline duration a clip occupies (speed-adjusted). */
export function clipDuration(c: Clip): number {
  return clipSourceLength(c) / c.speed;
}

export function clipEnd(c: Clip): number {
  return c.start_s + clipDuration(c);
}

export function getTrack(t: Timeline, id: string): Track | undefined {
  return t.tracks.find((tr) => tr.id === id);
}

export function getClip(t: Timeline, id: string): Clip | undefined {
  return t.clips[id];
}

export function getCaption(t: Timeline, id: string): Caption | undefined {
  return t.captions[id];
}

/** Captions attached to a clip, in timeline order. */
export function captionsOf(t: Timeline, clipId: string): Caption[] {
  return Object.values(t.captions)
    .filter((c) => c.clip_id === clipId)
    .sort((a, b) => a.start_s - b.start_s);
}

/** Clips on a track in timeline order. */
export function trackClips(t: Timeline, trackId: string): Clip[] {
  const track = getTrack(t, trackId);
  if (!track) return [];
  return track.clip_ids.map((id) => t.clips[id]).filter((c): c is Clip => c !== undefined);
}

/** The B-roll track, created by the engine on first insert. */
export function brollTrackName(kind: TrackKind): string {
  return kind === "video" ? "B-roll" : "B-roll audio";
}

/**
 * Deterministic deep clone. Timeline values are plain JSON data, so this is
 * exact and cheap enough for batch simulation.
 */
export function cloneTimeline(t: Timeline): Timeline {
  return structuredClone(t);
}

/** Deep equality helper for tests (JSON-stable data). */
export function timelinesEqual(a: Timeline, b: Timeline): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Stable JSON: sorts object keys recursively so equality is key-order proof. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Immutable update helper for tracks/clips/captions maps. */
export function withClip(t: Timeline, clip: Clip): Timeline {
  const next = cloneTimeline(t);
  next.clips[clip.id] = clip;
  return next;
}

/** A fresh timeline with the standard three tracks. */
export function emptyTimeline(idFor: (prefix: "trk") => string = (p) => generateId(p)): Timeline {
  const videoId = idFor("trk");
  const audioId = idFor("trk");
  const captionId = idFor("trk");
  return {
    version: 1,
    tracks: [
      { id: videoId, kind: "video", name: "Video", position: 0, audio: null, clip_ids: [] },
      { id: audioId, kind: "audio", name: "Audio", position: 1, audio: null, clip_ids: [] },
      { id: captionId, kind: "caption", name: "Captions", position: 2, audio: null, clip_ids: [] },
    ],
    clips: {},
    captions: {},
    audio: null,
  };
}

/** The caption track (created lazily by caption ops). */
export function captionTrack(t: Timeline): Track | undefined {
  return t.tracks.find((tr) => tr.kind === "caption");
}

/**
 * Re-lay a track sequentially from 0. Returns [timeline, deltas] where deltas
 * maps clip_id -> position delta so captions can be shifted consistently.
 */
export function repackTrack(t: Timeline, trackId: string): { timeline: Timeline; deltas: Record<string, number> } {
  const track = getTrack(t, trackId);
  if (!track) return { timeline: t, deltas: {} };
  const next = cloneTimeline(t);
  const deltas: Record<string, number> = {};
  let cursor = 0;
  for (const id of track.clip_ids) {
    const clip = next.clips[id]!;
    deltas[id] = cursor - clip.start_s;
    clip.start_s = cursor;
    cursor += clipDuration(clip);
  }
  // Captions follow their clips.
  for (const capId of Object.keys(next.captions)) {
    const cap = next.captions[capId]!;
    const delta = deltas[cap.clip_id];
    if (delta) {
      cap.start_s += delta;
      cap.end_s += delta;
    }
  }
  return { timeline: next, deltas };
}

/**
 * Ripple (invariant #5): shift every clip on `trackId` starting at or after
 * `fromS` (excluding `excludeId`) by `delta`, captions included.
 */
export function rippleTrack(
  t: Timeline,
  trackId: string,
  fromS: number,
  delta: number,
  excludeId?: string,
): Timeline {
  if (delta === 0) return t;
  const track = getTrack(t, trackId);
  if (!track) return t;
  const next = cloneTimeline(t);
  for (const id of track.clip_ids) {
    if (id === excludeId) continue;
    const clip = next.clips[id]!;
    if (clip.start_s < fromS - 1e-9) continue;
    clip.start_s += delta;
    for (const capId of Object.keys(next.captions)) {
      const cap = next.captions[capId]!;
      if (cap.clip_id === id) {
        cap.start_s += delta;
        cap.end_s += delta;
      }
    }
  }
  return next;
}
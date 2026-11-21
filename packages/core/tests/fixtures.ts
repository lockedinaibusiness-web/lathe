/**
 * Shared deterministic fixtures for the core test suite.
 *
 * Everything is fixed: IDs are sequential (minted), the source index has
 * planted words and silences, and timelines are built from the same shapes
 * the API will persist.
 */

import type { Operation } from "@lathe/schemas";
import { emptyTimeline, type Timeline, type Clip, type Track, type Caption } from "../src/timeline.js";
import type { ApplyContext } from "../src/ops-helpers.js";
import type { SourceIndex } from "../src/snap.js";

/** Deterministic sequential ID minting for tests. */
export function testMint(): (prefix: string) => string {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_TEST${String(n).padStart(6, "0")}`;
  };
}

/** A source index with planted words/silences at known times. */
export function testSource(durationS = 600): SourceIndex {
  // Words every 0.4 s from 1.0 s: [1.0,1.3], [1.4,1.7], ...
  const words = [];
  for (let t = 1.0; t + 0.3 < durationS; t += 0.4) {
    words.push({ segment_id: "seg_TEST000001", word_index: words.length, s: t, e: t + 0.3 });
  }
  return {
    duration_s: durationS,
    fps: 25,
    words,
    silences: [
      { s: 100.0, e: 101.5 },
      { s: 200.0, e: 203.0 },
      { s: 300.5, e: 300.9 },
    ],
  };
}

export function testCtx(source: SourceIndex = testSource()): ApplyContext {
  return { source, mint: testMint(), actor: "model:test" };
}

/** A clip builder with engine defaults filled. */
export function makeClip(overrides: Partial<Clip> & Pick<Clip, "id" | "track_id" | "segment_id">): Clip {
  return {
    start_s: 0,
    source_in_s: 0,
    source_out_s: 10,
    speed: 1,
    reframe: null,
    zoom: null,
    transition: null,
    audio: null,
    overlays: [],
    ...overrides,
  };
}

export function makeTrack(overrides: Partial<Track> & Pick<Track, "id" | "kind">): Track {
  return {
    name: overrides.kind === "video" ? "Video" : overrides.kind === "audio" ? "Audio" : "Captions",
    position: 0,
    audio: null,
    clip_ids: [],
    ...overrides,
  };
}

/** A timeline with three sequential clips on the video track: [0,10) [10,20) [20,30). */
export function sequenceTimeline(): { timeline: Timeline; trackId: string; clipIds: string[] } {
  const mint = testMint();
  const timeline = emptyTimeline(() => mint("trk"));
  const videoTrack = timeline.tracks[0]!;
  const trackId = videoTrack.id;
  const clipIds: string[] = [];
  let cursor = 0;
  for (let i = 0; i < 3; i++) {
    const id = `clp_SEQ${String(i + 1).padStart(6, "0")}`;
    timeline.clips[id] = makeClip({ id, track_id: trackId, segment_id: `seg_SEQ${String(i + 1).padStart(6, "0")}`, start_s: cursor, source_in_s: 0, source_out_s: 10 });
    videoTrack.clip_ids.push(id);
    clipIds.push(id);
    cursor += 10;
  }
  return { timeline, trackId, clipIds };
}

/** Every operation type with a valid, target-resolving sample against `seq`. */
export function sampleOps(trackId: string, clipIds: string[]): Operation[] {
  const c1 = clipIds[0]!;
  const c2 = clipIds[1]!;
  const c3 = clipIds[2]!;
  const grp = "grp_TEST000001";
  const base = { group_id: grp, rationale: "test op" };
  return [
    { id: "op_TESTOP00001", type: "split", ...base, target: { clip_id: c1, at: { kind: "seconds", seconds: 5 } }, params: {} },
    { id: "op_TESTOP00002", type: "trim", ...base, target: { clip_id: c2 }, params: { side: "in", in: { kind: "clip", clip_id: c2, edge: "in", offset_s: 2 }, ripple: true } },
    { id: "op_TESTOP00003", type: "delete", ...base, target: { clip_id: c3 }, params: { ripple: true } },
    { id: "op_TESTOP00004", type: "ripple_delete", ...base, target: { clip_id: c1 }, params: { ripple: true } },
    { id: "op_TESTOP00005", type: "reorder", ...base, target: { clip_id: c3 }, params: { to_index: 0 } },
    { id: "op_TESTOP00006", type: "set_speed", ...base, target: { clip_id: c1 }, params: { speed: 2, preserve_pitch: true } },
    { id: "op_TESTOP00007", type: "reframe", ...base, target: { clip_id: c1 }, params: { aspect: "9:16", mode: "subject", smoothing_s: 0.5, zoom: 1, reset: false } },
    { id: "op_TESTOP00008", type: "zoom", ...base, target: { clip_id: c1 }, params: { scale: 1.15, ease: "ease_in_out", reset: false } },
    { id: "op_TESTOP00009", type: "add_transition", ...base, target: { clip_id: c1 }, params: { kind: "crossfade", duration_s: 0.5 } },
    { id: "op_TESTOP00010", type: "add_caption", ...base, target: { clip_id: c1 }, params: { text: "hello world" } },
    { id: "op_TESTOP00011", type: "style_caption", ...base, target: { caption_id: "cap_TEST000001" }, params: { style_id: "sty_TEST000001" } },
    { id: "op_TESTOP00012", type: "add_overlay", ...base, target: { clip_id: c1 }, params: { kind: "logo", asset_id: "ast_TEST000001", from: { kind: "clip", clip_id: c1, edge: "in", offset_s: 1 }, to: { kind: "clip", clip_id: c1, edge: "in", offset_s: 4 }, opacity: 1 } },
    { id: "op_TESTOP00013", type: "set_gain", ...base, target: { clip_id: c1 }, params: { gain_db: -3 } },
    { id: "op_TESTOP00014", type: "duck_audio", ...base, target: { track_id: trackId }, params: { duck_db: -12, under: "speech", fade_s: 0.3, clear: false } },
    { id: "op_TESTOP00015", type: "normalize_audio", ...base, target: { scope: "project" }, params: { target_lufs: -16, true_peak_dbtp: -1, clear: false } },
    { id: "op_TESTOP00016", type: "insert_broll", ...base, target: { clip_id: c1, at: { kind: "seconds", seconds: 4 } }, params: { source: { kind: "project_asset", asset_id: "ast_TEST000002" }, duration_s: 3, audio: "duck" } },
  ] as Operation[];
}

/** Deep-equal for timelines (key-order proof). */
export { timelinesEqual, stableStringify } from "../src/timeline.js";

/** Clip accessor that reads `Clip | undefined` as `Clip` for test brevity. */
export function clipAt(t: Timeline, id: string): Clip {
  const clip = t.clips[id];
  if (!clip) throw new Error(`no clip ${id}`);
  return clip;
}

/** Caption accessor with the same contract. */
export function captionAt(t: Timeline, id: string): Caption {
  const cap = t.captions[id];
  if (!cap) throw new Error(`no caption ${id}`);
  return cap;
}
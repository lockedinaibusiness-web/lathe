/**
 * Invariant #2: every operation is invertible. Apply followed by inverse
 * returns a byte-identical timeline state.
 *
 * Property-based with fast-check: random timelines x random valid operations.
 * We generate operations that resolve against the current timeline, apply,
 * then apply the engine-computed inverse and compare with stableStringify
 * (key-order-proof deep equality).
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Operation } from "@lathe/schemas";
import { applyOperation } from "../src/ops.js";
import { applyOperations } from "../src/ops.js";
import { stableStringify, type Timeline, type Clip, type Track } from "../src/timeline.js";
import { testCtx, testSource } from "./fixtures.js";
import type { SourceIndex } from "../src/snap.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const IDS = ["clp_P0000000001", "clp_P0000000002", "clp_P0000000003"] as const;
const SEGS = ["seg_P0000000001", "seg_P0000000002", "seg_P0000000003"] as const;
const TRK_IDS = ["trk_P0000000001", "trk_P0000000002", "trk_P0000000003"] as const;

/** A valid operation that resolves against `t` (or a no-op-safe fallback). */
function randomOp(t: Timeline, n: number): Operation {
  const clipIds = Object.keys(t.clips);
  const clip = clipIds.length > 0 ? clipIds[Math.floor(Math.random() * clipIds.length)]! : IDS[0]!;
  const trackId = t.tracks[0]?.id ?? TRK_IDS[0]!;
  const id = `op_P${String(n).padStart(10, "0")}`;
  const grp = "grp_P0000000001";
  const rationale = "invariant #2 property";
  const kinds = [
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
    "set_gain",
    "duck_audio",
    "normalize_audio",
    "insert_broll",
    "style_caption",
    "add_overlay",
  ] as const;
  const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
  const base = { id, type: kind, group_id: grp, rationale } as Record<string, unknown>;
  switch (kind) {
    case "split":
      return { ...base, target: { clip_id: clip, at: { kind: "seconds", seconds: 2.5 } }, params: {} } as Operation;
    case "trim":
      return {
        ...base,
        target: { clip_id: clip },
        params: { side: "in", in: { kind: "clip", clip_id: clip, edge: "in", offset_s: 1.5 }, ripple: Math.random() > 0.5 },
      } as Operation;
    case "delete":
      return { ...base, target: { clip_id: clip }, params: { ripple: Math.random() > 0.5 } } as Operation;
    case "ripple_delete":
      return { ...base, target: { clip_id: clip }, params: { ripple: true } } as Operation;
    case "reorder":
      return { ...base, target: { clip_id: clip }, params: { to_index: Math.floor(Math.random() * 3) } } as Operation;
    case "set_speed":
      return { ...base, target: { clip_id: clip }, params: { speed: 1 + Math.random(), preserve_pitch: true } } as Operation;
    case "reframe":
      return { ...base, target: { clip_id: clip }, params: { aspect: "9:16", mode: "subject", smoothing_s: 0.3, zoom: 1, reset: false } } as Operation;
    case "zoom":
      return { ...base, target: { clip_id: clip }, params: { scale: 1.1, ease: "linear", reset: false } } as Operation;
    case "add_transition":
      return { ...base, target: { clip_id: clip }, params: { kind: "crossfade", duration_s: 0.4 } } as Operation;
    case "add_caption":
      return {
        ...base,
        target: { clip_id: clip },
        params: { text: "prop caption", from: { kind: "clip", clip_id: clip, edge: "in", offset_s: 1 }, to: { kind: "clip", clip_id: clip, edge: "in", offset_s: 4 } },
      } as Operation;
    case "set_gain":
      return { ...base, target: { clip_id: clip }, params: { gain_db: Math.round((Math.random() - 0.5) * 12) } } as Operation;
    case "duck_audio":
      return { ...base, target: { track_id: trackId }, params: { duck_db: -8, under: "speech", fade_s: 0.2, clear: false } } as Operation;
    case "normalize_audio":
      return { ...base, target: { scope: "project" }, params: { target_lufs: -16, true_peak_dbtp: -1, clear: false } } as Operation;
    case "insert_broll":
      return {
        ...base,
        target: { clip_id: clip, at: { kind: "clip", clip_id: clip, edge: "in", offset_s: 2 } },
        params: { source: { kind: "project_asset", asset_id: "ast_P0000000001" }, duration_s: 2, audio: "mute" },
      } as Operation;
    case "style_caption": {
      const capIds = Object.keys(t.captions);
      if (capIds.length === 0) {
        // No captions: fall back to a harmless reframe.
        return { ...base, type: "reframe", target: { clip_id: clip }, params: { aspect: "1:1", mode: "center", smoothing_s: 0.1, zoom: 1, reset: false } } as Operation;
      }
      return { ...base, target: { caption_id: capIds[0]! }, params: { style_id: "sty_P0000000001" } } as Operation;
    }
    case "add_overlay":
      return {
        ...base,
        target: { clip_id: clip },
        params: {
          kind: "text",
          text: "prop overlay",
          from: { kind: "clip", clip_id: clip, edge: "in", offset_s: 1 },
          to: { kind: "clip", clip_id: clip, edge: "in", offset_s: 3 },
          opacity: 0.5,
        },
      } as Operation;
  }
}

/** A random legal-ish timeline: 1-3 clips on the video track. */
function randomTimeline(): fc.Arbitrary<Timeline> {
  return fc
    .array(
      fc.record({
        len: fc.integer({ min: 5, max: 20 }),
        speed: fc.double({ min: 0.5, max: 2, noNaN: true }),
        reframe: fc.boolean(),
        zoom: fc.boolean(),
        gain: fc.boolean(),
      }),
      { minLength: 1, maxLength: 3 },
    )
    .map((specs) => {
      const tracks: Track[] = [
        { id: TRK_IDS[0]!, kind: "video", name: "Video", position: 0, audio: null, clip_ids: [] },
        { id: TRK_IDS[1]!, kind: "audio", name: "Audio", position: 1, audio: null, clip_ids: [] },
        { id: TRK_IDS[2]!, kind: "caption", name: "Captions", position: 2, audio: null, clip_ids: [] },
      ];
      const clips: Record<string, Clip> = {};
      // Speeds and starts are quantized to microsecond precision so the
      // generator produces states the engine can round-trip exactly.
      let cursor = 0;
      specs.forEach((spec, i) => {
        const id = IDS[i % IDS.length]!;
        const speed = Math.round(spec.speed * 1e6) / 1e6;
        const len = spec.len;
        clips[id] = {
          id,
          track_id: TRK_IDS[0]!,
          segment_id: SEGS[i % SEGS.length]!,
          start_s: cursor,
          source_in_s: 0,
          source_out_s: len,
          speed,
          reframe: spec.reframe ? { aspect: "16:9", mode: "subject", smoothing_s: 0.2, zoom: 1 } : null,
          zoom: spec.zoom ? { scale: 1.05, ease: "linear" } : null,
          transition: null,
          audio: spec.gain ? { gain_db: 1.5 } : null,
          overlays: [],
        };
        tracks[0]!.clip_ids.push(id);
        cursor = Math.round((cursor + len / speed) * 1e6) / 1e6;
      });
      return { version: 1, tracks, clips, captions: {}, audio: null };
    });
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

/** First differing slice between two strings, for actionable failures. */
function firstDiff(a: string, b: string): string {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return `@${i}: '${a.slice(Math.max(0, i - 30), i + 30)}' vs '${b.slice(Math.max(0, i - 30), i + 30)}'`;
  }
  return a.length === b.length ? "identical" : `length ${a.length} vs ${b.length}`;
}

describe("invariant #2: apply(op) then apply(inverse) is the identity", () => {
  it("holds for random timelines and single operations", () => {
    fc.assert(
      fc.property(randomTimeline(), fc.integer({ min: 1, max: 12 }), (timeline, seed) => {
        const ctx = testCtx();
        let s = seed * 7919;
        const rng = () => {
          s = (s * 1103515245 + 12345) % 2147483648;
          return s / 2147483648;
        };
        const op = withRng(rng, () => randomOp(timeline, 1));
        const before = stableStringify(timeline);
        let applied: Timeline;
        let inverse: Operation[];
        try {
          const r = applyOperation(timeline, op, ctx);
          applied = r.timeline;
          inverse = r.inverse;
        } catch {
          expect(stableStringify(timeline), `input mutated by rejected ${op.type}`).toBe(before);
          return true;
        }
        const restored = applyOperations(applied, inverse, ctx).timeline;
        const after = stableStringify(restored);
        expect(after, `op ${op.type}: ${firstDiff(before, after)}`).toBe(before);
        return true;
      }),
      { numRuns: 250 },
    );
  });

  it("holds for sequences of operations applied then inverse-drained LIFO", () => {
    fc.assert(
      fc.property(randomTimeline(), fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 30 }), (timeline, count, seed) => {
        const ctx = testCtx();
        let s = seed * 104729 + 17;
        const rng = () => {
          s = (s * 1103515245 + 12345) % 2147483648;
          return s / 2147483648;
        };
        const before = stableStringify(timeline);
        let current = timeline;
        const inverses: Operation[][] = [];
        for (let i = 0; i < count; i++) {
          const op = withRng(rng, () => randomOp(current, i + 1));
          try {
            const r = applyOperation(current, op, ctx);
            current = r.timeline;
            inverses.push(r.inverse);
          } catch {
            // Skip ops that legitimately fail; the property is about the
            // applied ones being invertible.
          }
        }
        // Undo everything, LIFO.
        for (let i = inverses.length - 1; i >= 0; i--) {
          current = applyOperations(current, inverses[i]!, ctx).timeline;
        }
        expect(stableStringify(current)).toBe(before);
        return true;
      }),
      { numRuns: 120 },
    );
  });

  it("apply never mutates its input timeline", () => {
    fc.assert(
      fc.property(randomTimeline(), fc.integer({ min: 1, max: 20 }), (timeline, seed) => {
        const ctx = testCtx();
        const before = stableStringify(timeline);
        withRng(mulberry(seed), () => randomOp(timeline, 1));
        try {
          applyOperation(timeline, withRng(mulberry(seed), () => randomOp(timeline, 1)), ctx);
        } catch {
          // rejections are fine
        }
        expect(stableStringify(timeline)).toBe(before);
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

/** Deterministic RNG for reproducible property runs. */
function mulberry(seed: number): () => number {
  let a = seed * 0x9e3779b9;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run `fn` with Math.random temporarily replaced by `rng`. */
function withRng<T>(rng: () => number, fn: () => T): T {
  const orig = Math.random;
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

describe("source fixture", () => {
  it("provides words and silences for snapping", () => {
    const s: SourceIndex = testSource(600);
    expect(s.words.length).toBeGreaterThan(100);
    expect(s.silences.length).toBe(3);
  });
});
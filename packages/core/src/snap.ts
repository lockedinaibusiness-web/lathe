/**
 * TimeSpec resolution and cut snapping (invariants #1 and #6).
 *
 * Operations never carry free-typed timestamps: they reference words, clip
 * edges, or frames. A raw `seconds` timecode is accepted ONLY because this
 * module snaps it to a word boundary or silence gap and reports the snap.
 */

import type { SnapPolicy, TimeSpec } from "@lathe/schemas";
import { DEFAULT_SNAP_POLICY, type SnapReport, type SnapTargetKind } from "@lathe/schemas";
import { clipDuration, getClip, type Timeline } from "./timeline.js";

export interface WordEntry {
  segment_id: string;
  word_index: number;
  s: number;
  e: number;
}

/** What the snapping engine knows about the source media. */
export interface SourceIndex {
  duration_s: number;
  fps?: number;
  words: WordEntry[];
  silences: { s: number; e: number }[];
}

export class SnapError extends Error {
  constructor(
    readonly code: "OP_INVALID_TIME" | "OP_TARGET_NOT_FOUND" | "OP_SNAP_AMBIGUOUS",
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "SnapError";
  }
}

/** Resolve a TimeSpec to source/timeline seconds without snapping. */
function resolve(spec: TimeSpec, timeline: Timeline, source: SourceIndex): number {
  switch (spec.kind) {
    case "word": {
      const word = source.words.find(
        (w) => w.segment_id === spec.segment_id && w.word_index === spec.word_index,
      );
      if (!word) {
        throw new SnapError(
          "OP_TARGET_NOT_FOUND",
          `word ${spec.word_index} of segment ${spec.segment_id} is not in the index`,
          "target.at",
        );
      }
      return spec.edge === "end" ? word.e : word.s;
    }
    case "clip": {
      const clip = getClip(timeline, spec.clip_id);
      if (!clip) {
        throw new SnapError("OP_TARGET_NOT_FOUND", `clip ${spec.clip_id} does not exist`, "target.clip_id");
      }
      const edge = spec.edge === "in" ? clip.start_s : clip.start_s + clipDuration(clip);
      return edge + spec.offset_s;
    }
    case "frame":
      return spec.frame / (spec.fps ?? source.fps ?? 30);
    case "seconds":
      return spec.seconds;
  }
}

/**
 * Resolve a TimeSpec and apply the snap policy, returning the report required
 * by invariant #1 (the response always reports where a cut actually landed).
 */
export function resolveAndSnap(
  opId: string,
  spec: TimeSpec,
  timeline: Timeline,
  source: SourceIndex,
  policy: SnapPolicy = DEFAULT_SNAP_POLICY,
): { applied_s: number; report: SnapReport } {
  const resolved = resolve(spec, timeline, source);

  if (!Number.isFinite(resolved) || resolved < 0 || resolved > source.duration_s) {
    throw new SnapError(
      "OP_INVALID_TIME",
      `time ${resolved} is outside the source range 0..${source.duration_s}s`,
    );
  }

  // Word and clip-edge references are exact by construction.
  if (spec.kind === "word" || spec.kind === "clip") {
    return {
      applied_s: resolved,
      report: {
        op_id: opId,
        requested: spec,
        resolved_s: resolved,
        applied_s: resolved,
        snapped_to: "none",
        delta_ms: 0,
        tolerance_ms: policy.tolerance_ms,
      },
    };
  }

  const tolerance = policy.tolerance_ms / 1000;
  let candidate = resolved;
  let snappedTo: SnapTargetKind = "none";

  // 1) Already inside a detected pause: the cut is well-placed as-is
  // (invariant #6 prefers silence gaps).
  const insideSilence = source.silences.find((si) => resolved >= si.s - 1e-9 && resolved <= si.e + 1e-9);
  if (insideSilence && policy.prefer_silence) {
    return {
      applied_s: resolved,
      report: {
        op_id: opId,
        requested: spec,
        resolved_s: resolved,
        applied_s: resolved,
        snapped_to: "silence",
        delta_ms: 0,
        tolerance_ms: policy.tolerance_ms,
      },
    };
  }

  // 2) Never land mid-word: snap to the nearest word edge.
  if (policy.avoid_mid_word) {
    const inside = source.words.find((w) => resolved > w.s + 1e-6 && resolved < w.e - 1e-6);
    if (inside) {
      candidate = resolved - inside.s <= inside.e - resolved ? inside.s : inside.e;
      snappedTo = "word";
    }
  }

  // 3) Prefer a silence gap boundary near the candidate.
  if (policy.prefer_silence) {
    const gap = nearestSilence(candidate, source.silences, tolerance);
    if (gap) {
      candidate = gap.at;
      snappedTo = "silence";
    }
  }

  // 4) Frame grid for free values. Skipped for "exact" policies
  // (avoid_mid_word:false + prefer_silence:false), which engine inverses use
  // to restore recorded positions without any movement (ADR-0013), and for
  // references that are already frame-exact.
  const exactPolicy = policy.avoid_mid_word === false && policy.prefer_silence === false;
  if (source.fps && snappedTo === "none" && !exactPolicy && spec.kind !== "frame") {
    candidate = Math.round(candidate * source.fps) / source.fps;
    snappedTo = "frame";
  }

  const deltaMs = Math.abs(candidate - resolved) * 1000;
  if (deltaMs > policy.tolerance_ms + 1e-6) {
    throw new SnapError(
      "OP_SNAP_AMBIGUOUS",
      `requested cut at ${resolved.toFixed(3)}s is ${deltaMs.toFixed(0)} ms from the nearest boundary, beyond the ${policy.tolerance_ms} ms tolerance`,
    );
  }

  const wordRef = snappedTo === "word" ? nearestWord(source.words, candidate) : undefined;
  return {
    applied_s: candidate,
    report: {
      op_id: opId,
      requested: spec,
      resolved_s: resolved,
      applied_s: candidate,
      snapped_to: snappedTo,
      delta_ms: Number(deltaMs.toFixed(3)),
      tolerance_ms: policy.tolerance_ms,
      ...(wordRef ? { word: wordRef } : {}),
    },
  };
}

function nearestSilence(
  t: number,
  silences: { s: number; e: number }[],
  tolerance: number,
): { at: number } | undefined {
  let best: { at: number; d: number } | undefined;
  for (const si of silences) {
    for (const c of [si.s, (si.s + si.e) / 2, si.e]) {
      const d = Math.abs(c - t);
      if (d <= tolerance && (best === undefined || d < best.d)) best = { at: c, d };
    }
  }
  return best ? { at: best.at } : undefined;
}

function nearestWord(words: WordEntry[], t: number): { segment_id: string; word_index: number } | undefined {
  let best: { segment_id: string; word_index: number; d: number } | undefined;
  for (const w of words) {
    for (const edge of [w.s, w.e]) {
      const d = Math.abs(edge - t);
      if (best === undefined || d < best.d) {
        best = { segment_id: w.segment_id, word_index: w.word_index, d };
      }
    }
  }
  return best ? { segment_id: best.segment_id, word_index: best.word_index } : undefined;
}
/**
 * set_gain / duck_audio / normalize_audio.
 *
 * Audio settings are absolute state on a clip, a track, or the project. The
 * engine stores intent; measurement and true normalization happen in the
 * render pipeline (the core never touches media). Inverses restore the
 * recorded prior values exactly (gain is always present, 0 = unity).
 */

import type { Operation } from "@lathe/schemas";
import { type Timeline, cloneTimeline, type ClipAudio } from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure, buildOp, needClip, needTrack } from "./ops-helpers.js";
import { resolveAndSnap } from "./snap.js";
import { EXACT_POLICY } from "./ops-helpers.js";

type AudioScope =
  | { kind: "clip"; clip_id: string }
  | { kind: "track"; track_id: string }
  | { kind: "project" };

function audioScope(op: Operation, _t: Timeline): AudioScope {
  if ("clip_id" in op.target) return { kind: "clip", clip_id: op.target.clip_id as string };
  if ("track_id" in op.target) return { kind: "track", track_id: op.target.track_id as string };
  if ("scope" in op.target && op.target.scope === "project") return { kind: "project" };
  throw new OpFailure("OP_INVALID_PARAMS", "audio op target must be a clip, a track, or the project", "target", op.id);
}

function readAudio(t: Timeline, scope: AudioScope): ClipAudio | null {
  switch (scope.kind) {
    case "clip": {
      const clip = t.clips[scope.clip_id];
      return clip ? clip.audio : null;
    }
    case "track": {
      const track = t.tracks.find((tr) => tr.id === scope.track_id);
      return track ? track.audio : null;
    }
    case "project":
      return t.audio;
  }
}

function writeAudio(t: Timeline, scope: AudioScope, audio: ClipAudio | null): Timeline {
  const next = cloneTimeline(t);
  switch (scope.kind) {
    case "clip": {
      const cc = next.clips[scope.clip_id];
      if (cc) cc.audio = audio;
      break;
    }
    case "track": {
      const tr = next.tracks.find((x) => x.id === scope.track_id);
      if (tr) tr.audio = audio;
      break;
    }
    case "project":
      next.audio = audio;
      break;
  }
  return next;
}

const EMPTY_AUDIO: ClipAudio = { gain_db: 0 };

export function applySetGain(t: Timeline, op: Operation & { type: "set_gain" }, ctx: ApplyContext): OpResult {
  const scope = audioScope(op, t);
  // Validate targets exist (clear errors instead of silent no-ops).
  if (scope.kind === "clip") needClip(t, scope.clip_id, op.id);
  if (scope.kind === "track") needTrack(t, scope.track_id, op.id);

  const prior = readAudio(t, scope);
  const next = writeAudio(t, scope, { ...(prior ?? EMPTY_AUDIO), gain_db: op.params.gain_db });

  const inverse: Operation[] = [
    buildOp(
      {
        type: "set_gain",
        target: op.target,
        params: { gain_db: prior?.gain_db ?? 0 },
        rationale: `restore gain`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}

export function applyDuckAudio(t: Timeline, op: Operation & { type: "duck_audio" }, ctx: ApplyContext): OpResult {
  const scope = audioScope(op, t);
  if (scope.kind === "clip") needClip(t, scope.clip_id, op.id);
  if (scope.kind === "track") needTrack(t, scope.track_id, op.id);

  const prior = readAudio(t, scope);
  const base: ClipAudio = { ...(prior ?? EMPTY_AUDIO) };
  let range: { from_s: number; to_s: number } | undefined;
  if (op.params.range) {
    // Range restores must be exact, so the engine uses the exact snap policy.
    const from = resolveAndSnap(op.id, op.params.range.from, t, ctx.source, EXACT_POLICY).applied_s;
    const to = resolveAndSnap(op.id, op.params.range.to, t, ctx.source, EXACT_POLICY).applied_s;
    if (!(to > from)) {
      throw new OpFailure("OP_INVALID_PARAMS", "duck range is empty", "params.range.to", op.id);
    }
    range = { from_s: from, to_s: to };
  }

  const nextAudio: ClipAudio = op.params.clear
    ? { ...base, duck: undefined }
    : {
        ...base,
        duck: {
          duck_db: op.params.duck_db,
          under: op.params.under,
          fade_s: op.params.fade_s,
          ...(range ? { range } : {}),
        },
      };
  const next = writeAudio(t, scope, nextAudio);

  const inverse: Operation[] = [
    buildOp(
      {
        type: "duck_audio",
        target: op.target,
        params: prior?.duck
          ? {
              duck_db: prior.duck.duck_db,
              under: prior.duck.under,
              fade_s: prior.duck.fade_s,
              ...(prior.duck.range
                ? {
                    range: {
                      from: { kind: "seconds" as const, seconds: prior.duck.range.from_s },
                      to: { kind: "seconds" as const, seconds: prior.duck.range.to_s },
                    },
                  }
                : {}),
            }
          : { duck_db: -12, clear: true },
        rationale: "restore ducking",
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}

export function applyNormalizeAudio(t: Timeline, op: Operation & { type: "normalize_audio" }, ctx: ApplyContext): OpResult {
  const scope = audioScope(op, t);
  if (scope.kind === "clip") needClip(t, scope.clip_id, op.id);
  if (scope.kind === "track") needTrack(t, scope.track_id, op.id);

  const prior = readAudio(t, scope);
  const base: ClipAudio = { ...(prior ?? EMPTY_AUDIO) };
  const nextAudio: ClipAudio = op.params.clear
    ? { ...base, normalize: undefined }
    : {
        ...base,
        normalize: { target_lufs: op.params.target_lufs, true_peak_dbtp: op.params.true_peak_dbtp },
      };
  const next = writeAudio(t, scope, nextAudio);

  const inverse: Operation[] = [
    buildOp(
      {
        type: "normalize_audio",
        target: op.target,
        params: prior?.normalize
          ? { target_lufs: prior.normalize.target_lufs, true_peak_dbtp: prior.normalize.true_peak_dbtp }
          : { target_lufs: -16, true_peak_dbtp: -1, clear: true },
        rationale: "restore normalization target",
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}
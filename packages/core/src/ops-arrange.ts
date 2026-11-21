/**
 * reorder / set_speed / restore_clip.
 *
 * reorder moves a clip within (or across same-kind) tracks and re-packs the
 * affected tracks sequentially. Inverse: reorder back to the original index.
 * set_speed changes duration (always ripples downstream; the timeline must
 * stay aligned). restore_clip re-inserts a captured pre-image.
 */

import type { Operation } from "@lathe/schemas";
import { seconds } from "@lathe/schemas";
import {
  type Timeline,
  clipDuration,
  clipEnd,
  rippleTrack,
  repackTrack,
  cloneTimeline,
} from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure, buildOp, needClip, needTrack, EXACT_POLICY } from "./ops-helpers.js";
import { resolveAndSnap } from "./snap.js";

export function applyReorder(t: Timeline, op: Operation & { type: "reorder" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const fromTrack = needTrack(t, clip.track_id, op.id);
  const toTrackId = op.params.to_track_id ?? clip.track_id;
  const toTrack = needTrack(t, toTrackId, op.id);
  if (toTrack.kind !== fromTrack.kind) {
    throw new OpFailure(
      "OP_INVALID_PARAMS",
      `cannot move a ${fromTrack.kind} clip to a ${toTrack.kind} track`,
      "params.to_track_id",
      op.id,
    );
  }
  if (toTrack.locked || fromTrack.locked) {
    throw new OpFailure("OP_INVALID_PARAMS", "track is locked", "target.clip_id", op.id);
  }

  const originalIndex = fromTrack.clip_ids.indexOf(clip.id);
  const next = cloneTimeline(t);
  const src = next.tracks.find((tr) => tr.id === fromTrack.id)!;
  src.clip_ids = src.clip_ids.filter((id) => id !== clip.id);

  // to_index is the index in the destination list after removal.
  const dst = next.tracks.find((tr) => tr.id === toTrack.id)!;
  dst.clip_ids.splice(Math.min(op.params.to_index, dst.clip_ids.length), 0, clip.id);
  const movedClip = next.clips[clip.id]!;
  movedClip.track_id = toTrackId;

  // Re-pack both tracks so positions stay gap-free and deterministic.
  repackTrack(next, fromTrack.id);
  repackTrack(next, toTrack.id);

  const inverse: Operation[] = [
    buildOp(
      {
        type: "reorder",
        target: { clip_id: clip.id },
        params: { to_index: originalIndex, to_track_id: fromTrack.id },
        rationale: `restore position of ${clip.id}`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}

export function applySetSpeed(t: Timeline, op: Operation & { type: "set_speed" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const oldSpeed = clip.speed;
  const oldEnd = clipEnd(clip);
  if (op.params.speed === oldSpeed) {
    return { timeline: t, inverse: [], created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
  }
  const next = cloneTimeline(t);
  const c = next.clips[clip.id]!;
  c.speed = op.params.speed;
  const newEnd = clipEnd(c);
  const delta = newEnd - oldEnd;
  const rippled = rippleTrack(next, clip.track_id, oldEnd, delta, clip.id);

  const inverse: Operation[] = [
    buildOp(
      { type: "set_speed", target: { clip_id: clip.id }, params: { speed: oldSpeed, preserve_pitch: true }, rationale: `restore speed of ${clip.id}` },
      ctx,
    ),
  ];

  return { timeline: rippled, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}

export function applyRestoreClip(t: Timeline, op: Operation & { type: "restore_clip" }, ctx: ApplyContext): OpResult {
  const track = needTrack(t, op.target.track_id, op.id);
  if (track.locked) throw new OpFailure("OP_INVALID_PARAMS", "track is locked", "target.track_id", op.id);

  const clip = op.params.clip;
  if (t.clips[clip.id]) {
    throw new OpFailure("OP_CONFLICT", `clip ${clip.id} already exists`, "params.clip.id", op.id);
  }
  const at = resolveAndSnap(op.id, seconds(op.params.at_s), t, ctx.source, EXACT_POLICY).applied_s;

  const restored = structuredClone(clip) as unknown as Timeline["clips"][string];
  restored.track_id = track.id;
  restored.start_s = at;
  const dur = clipDuration(restored);

  const next = cloneTimeline(t);
  if (op.params.ripple) rippleTrack(next, track.id, at, dur);
  const trackRef = next.tracks.find((tr) => tr.id === track.id)!;
  const insertAt = trackRef.clip_ids.findIndex((id) => (next.clips[id]?.start_s ?? Infinity) > at);
  trackRef.clip_ids.splice(insertAt < 0 ? trackRef.clip_ids.length : insertAt, 0, restored.id);
  next.clips[restored.id] = restored;
  for (const cap of op.params.captions) {
    const c = structuredClone(cap) as Timeline["captions"][string];
    next.captions[c.id] = c;
  }

  const inverse: Operation[] = [
    buildOp(
      {
        type: "delete",
        target: { clip_id: restored.id },
        params: { ripple: op.params.ripple },
        rationale: `drop restored clip ${restored.id}`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [restored.id], caption_ids: op.params.captions.map((c) => c.id as string), effect_ids: [] }, snaps: [] };
}
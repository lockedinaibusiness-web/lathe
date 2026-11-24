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
  captionsOf,
  q,
} from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure, buildOp, needClip, needTrack, EXACT_POLICY, clipPreImage, captionPreImage, realTrackClipIds } from "./ops-helpers.js";
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

  const next = cloneTimeline(t);
  const src = next.tracks.find((tr) => tr.id === fromTrack.id)!;
  src.clip_ids = src.clip_ids.filter((id) => id !== clip.id);

  // to_index is the index in the destination list after removal.
  const dst = next.tracks.find((tr) => tr.id === toTrack.id)!;
  dst.clip_ids.splice(Math.min(op.params.to_index, dst.clip_ids.length), 0, clip.id);
  const movedClip = next.clips[clip.id]!;
  movedClip.track_id = toTrackId;

  // Re-pack both tracks so positions stay gap-free and deterministic.
  // repackTrack returns a NEW timeline; the pack must be threaded through.
  let packed = repackTrack(next, fromTrack.id).timeline;
  if (toTrackId !== fromTrack.id) {
    packed = repackTrack(packed, toTrack.id).timeline;
  }
  const finalTimeline = packed;

  // Inverse: restore the exact pre-images of every clip on both tracks.
  // Positional inverses (reorder back, re-pack) cannot be byte-exact across
  // irrational speeds; pre-image restoration is (ADR-0013).
  const inverse: Operation[] = [];
  for (const tr of [fromTrack.id, toTrackId]) {
    const originalOrder = realTrackClipIds(t, tr);
    originalOrder.forEach((id, orderIndex) => {
      const c = t.clips[id]!;
      inverse.push(
        buildOp(
          {
            type: "restore_clip",
            target: { track_id: tr },
            params: {
              clip: clipPreImage(c),
              captions: captionsOf(t, c.id).map(captionPreImage),
              at_s: c.start_s,
              order_index: orderIndex,
            },
            rationale: `restore pre-image of ${c.id}`,
          },
          ctx,
        ),
      );
    });
  }

  return { timeline: finalTimeline, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}

export function applySetSpeed(t: Timeline, op: Operation & { type: "set_speed" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const oldSpeed = clip.speed;
  const oldEnd = q(clipEnd(clip));
  if (op.params.speed === oldSpeed) {
    return { timeline: t, inverse: [], created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
  }
  const next = cloneTimeline(t);
  const c = next.clips[clip.id]!;
  c.speed = op.params.speed;
  const newEnd = q(clipEnd(c));
  const delta = newEnd - oldEnd;
  const rippled = rippleTrack(next, clip.track_id, oldEnd, delta, clip.id);

  // Inverse: restore pre-images of every clip on the track. The speed change
  // ripples downstream clips, so restoring only this clip would leave them
  // shifted; pre-image restoration of the whole track is byte-exact.
  const inverse: Operation[] = [];
  for (const id of realTrackClipIds(t, clip.track_id)) {
    const c = t.clips[id]!;
    inverse.push(
      buildOp(
        {
          type: "restore_clip",
          target: { track_id: clip.track_id },
          params: {
            clip: clipPreImage(c),
            captions: captionsOf(t, c.id).map(captionPreImage),
            at_s: c.start_s,
          },
          rationale: `restore pre-image of ${c.id}`,
        },
        ctx,
      ),
    );
  }

  return { timeline: rippled, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}

export function applyRestoreClip(t: Timeline, op: Operation & { type: "restore_clip" }, ctx: ApplyContext): OpResult {
  const track = needTrack(t, op.target.track_id, op.id);
  if (track.locked) throw new OpFailure("OP_INVALID_PARAMS", "track is locked", "target.track_id", op.id);

  const clip = op.params.clip;
  const existing = t.clips[clip.id];

  if (existing) {
    // REPLACE semantics: the engine emits restore_clip as the exact inverse
    // of mutating ops (trim/split/set_speed/reorder). The clip persists; its
    // fields are replaced by the pre-image in place — order untouched, no
    // ripple, positions taken verbatim from the pre-image (byte-exact).
    const next = cloneTimeline(t);
    const replaced = structuredClone(clip) as unknown as Timeline["clips"][string];
    replaced.track_id = existing.track_id;
    next.clips[clip.id] = replaced;
    for (const cap of op.params.captions) {
      const c = structuredClone(cap) as Timeline["captions"][string];
      next.captions[c.id] = c;
    }
    // Reorder inverses also restore the track order index.
    const trackRef = next.tracks.find((tr) => tr.id === existing.track_id);
    if (trackRef && op.params.order_index !== undefined) {
      const current = trackRef.clip_ids.indexOf(clip.id);
      if (current !== -1 && current !== op.params.order_index) {
        trackRef.clip_ids.splice(current, 1);
        trackRef.clip_ids.splice(
          Math.min(op.params.order_index, trackRef.clip_ids.length),
          0,
          clip.id,
        );
      }
    }
    const back: Operation[] = [
      buildOp(
        {
          type: "restore_clip",
          target: { track_id: existing.track_id },
          params: {
            clip: clipPreImage(existing),
            captions: captionsOf(t, existing.id).map(captionPreImage),
            at_s: existing.start_s,
            order_index: trackRef?.clip_ids.indexOf(existing.id),
          },
          rationale: `restore clip ${existing.id} to its post-op state`,
        },
        ctx,
      ),
    ];
    return { timeline: next, inverse: back, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
  }

  const at = resolveAndSnap(op.id, seconds(op.params.at_s), t, ctx.source, EXACT_POLICY).applied_s;

  const restored = structuredClone(clip) as unknown as Timeline["clips"][string];
  restored.track_id = track.id;
  restored.start_s = q(at);
  // B-roll pre-images carry the source key in asset_ref; the model keeps it
  // in segment_id.
  const assetRef = (clip as { asset_ref?: string }).asset_ref;
  if (assetRef !== undefined && clip.segment_id === undefined) {
    restored.segment_id = assetRef;
  }
  const dur = clipDuration(restored);

  // rippleTrack returns a new timeline; thread it through.
  const next = op.params.ripple ? rippleTrack(cloneTimeline(t), track.id, at, dur) : cloneTimeline(t);
  // The virtual B-roll track derives its order from the clips themselves.
  const trackRef = next.tracks.find((tr) => tr.id === track.id);
  if (trackRef) {
    if (op.params.order_index !== undefined) {
      // Exact order restoration (delete's inverse).
      trackRef.clip_ids.splice(
        Math.min(op.params.order_index, trackRef.clip_ids.length),
        0,
        restored.id,
      );
    } else {
      const insertAt = trackRef.clip_ids.findIndex((id) => (next.clips[id]?.start_s ?? Infinity) > at);
      trackRef.clip_ids.splice(insertAt < 0 ? trackRef.clip_ids.length : insertAt, 0, restored.id);
    }
  }
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
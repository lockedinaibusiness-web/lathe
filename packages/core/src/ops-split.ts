/**
 * split: divide a clip at a snapped point into two adjacent clips.
 * Inverse: delete the new clip, then extend the original back out.
 */

import type { Operation } from "@lathe/schemas";
import {
  type Timeline,
  type Clip,
  clipDuration,
  cloneTimeline,
  getTrack,
} from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure, buildOp, mintId, needClip, snapTime, EXACT_POLICY } from "./ops-helpers.js";
import { seconds } from "@lathe/schemas";

export function applySplit(t: Timeline, op: Operation & { type: "split" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const { applied_s: p, report } = snapTime(op.id, op.target.at, t, ctx, op.params.snap_policy);

  const dur = clipDuration(clip);
  const rel = p - clip.start_s;
  const minLen = 1 / (ctx.source.fps ?? 30);
  if (rel <= minLen || rel >= dur - minLen) {
    throw new OpFailure(
      "OP_INVALID_PARAMS",
      `split point ${p.toFixed(3)}s must leave at least one frame on each side of clip ${clip.id}`,
      "target.at",
      op.id,
    );
  }

  const track = getTrack(t, clip.track_id);
  if (!track) throw new OpFailure("OP_TARGET_NOT_FOUND", `track ${clip.track_id} missing`, "target.clip_id", op.id);

  const sourceAt = clip.source_in_s + rel * clip.speed;
  const oldEnd = clip.start_s + dur;
  const newId = op.params.new_clip_id ?? mintId(ctx, "clp");
  const newClip: Clip = {
    ...structuredClone(clip),
    id: newId,
    start_s: p,
    source_in_s: sourceAt,
    source_out_s: clip.source_out_s,
    overlays: [],
    transition: null,
  };
  const leftClip: Clip = { ...structuredClone(clip), source_out_s: sourceAt };

  const next = cloneTimeline(t);
  next.clips[leftClip.id] = leftClip;
  next.clips[newClip.id] = newClip;
  const trackRef = next.tracks.find((tr) => tr.id === track.id);
  if (!trackRef) throw new OpFailure("OP_TARGET_NOT_FOUND", `track ${track.id} missing`, "target.clip_id", op.id);
  const insertAt = trackRef.clip_ids.indexOf(clip.id) + 1;
  trackRef.clip_ids.splice(insertAt, 0, newClip.id);
  // Captions starting at/after the split point move to the right-hand clip.
  for (const cap of Object.values(next.captions)) {
    if (cap.clip_id === clip.id && cap.start_s >= p - 1e-9) cap.clip_id = newClip.id;
  }

  const inverse: Operation[] = [
    buildOp(
      { type: "delete", target: { clip_id: newClip.id }, params: { ripple: false }, rationale: `undo split of ${clip.id}` },
      ctx,
    ),
    buildOp(
      {
        type: "trim",
        target: { clip_id: clip.id },
        params: { side: "out", out: seconds(oldEnd), ripple: false, snap_policy: EXACT_POLICY },
        rationale: `restore out point of ${clip.id}`,
      },
      ctx,
    ),
  ];

  return {
    timeline: next,
    inverse,
    created: { clip_ids: [newClip.id], caption_ids: [], effect_ids: [] },
    snaps: [report],
  };
}
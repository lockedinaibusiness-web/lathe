/**
 * trim: move a clip's in/out points; ripple downstream by default (#5).
 * Inverse: trim back to the recorded bounds (exact policy).
 */

import type { Operation, SnapReport } from "@lathe/schemas";
import { type Timeline, clipEnd, rippleTrack, cloneTimeline, captionsOf, q } from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure, buildOp, needClip, snapTime, minClipLength, clipPreImage, captionPreImage, realTrackClipIds } from "./ops-helpers.js";

export function applyTrim(t: Timeline, op: Operation & { type: "trim" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const snaps: SnapReport[] = [];
  const policy = op.params.snap_policy;

  const oldStart = q(clip.start_s);
  const oldEnd = q(clipEnd(clip));

  // Resolve requested bounds.
  let newStart = oldStart;
  let newEnd = oldEnd;
  if (op.params.side === "in" || op.params.side === "both") {
    if (!op.params.in) {
      throw new OpFailure("OP_INVALID_PARAMS", "trim side in/both requires an in time", "params.in", op.id);
    }
    const r = snapTime(op.id, op.params.in, t, ctx, policy);
    newStart = r.applied_s;
    snaps.push(r.report);
  }
  if (op.params.side === "out" || op.params.side === "both") {
    if (!op.params.out) {
      throw new OpFailure("OP_INVALID_PARAMS", "trim side out/both requires an out time", "params.out", op.id);
    }
    const r = snapTime(op.id, op.params.out, t, ctx, policy);
    newEnd = r.applied_s;
    snaps.push(r.report);
  }

  const minLen = minClipLength(ctx);
  if (newEnd - newStart < minLen) {
    throw new OpFailure(
      "OP_INVALID_PARAMS",
      `trimmed length ${(newEnd - newStart).toFixed(3)}s is under one frame (${(minLen * 1000).toFixed(1)} ms)`,
      "params",
      op.id,
    );
  }
  // Bounds are the SOURCE MEDIA, not the clip's current (possibly trimmed)
  // range: a trimmed clip can be extended back into media it still has.
  const maxEndFromSource = clip.start_s + (ctx.source.duration_s - clip.source_in_s) / clip.speed;
  if (newEnd > maxEndFromSource + 1e-9) {
    throw new OpFailure(
      "OP_INVALID_PARAMS",
      `trim out cannot extend past the end of the source media (${ctx.source.duration_s}s)`,
      "params.out",
      op.id,
    );
  }
  const minStartFromSource = clip.start_s - clip.source_in_s / clip.speed;
  if (newStart < minStartFromSource - 1e-9) {
    throw new OpFailure(
      "OP_INVALID_PARAMS",
      "trim in cannot extend past the start of the source media",
      "params.in",
      op.id,
    );
  }

  // Ripple (invariant #5): trimming the in-point removes [oldStart, newStart),
  // so material after the old start shifts LEFT by that amount; trimming the
  // out-point removes [newEnd, oldEnd), so material after the old end shifts
  // by (newEnd - oldEnd). Both apply for side "both".
  const startShift = oldStart - newStart;
  const endShift = newEnd - oldEnd;
  // Always work on a copy: rippleTrack clones, but a no-ripple trim would
  // otherwise mutate the caller's timeline in place.
  let next = cloneTimeline(t);
  if (op.params.ripple && (op.params.side === "in" || op.params.side === "both") && startShift !== 0) {
    next = rippleTrack(next, clip.track_id, oldStart, startShift, clip.id);
  }
  if (op.params.ripple && (op.params.side === "out" || op.params.side === "both") && endShift !== 0) {
    next = rippleTrack(next, clip.track_id, oldEnd, endShift, clip.id);
  }
  // Quantized deltas: the inverse recomputes q(-delta) from the restored
  // positions, and q is symmetric, so forward + inverse cancel exactly.
  const c = next.clips[clip.id]!;
  c.start_s = q(newStart);
  c.source_in_s = q(clip.source_in_s + q((newStart - oldStart) * clip.speed));
  c.source_out_s = q(c.source_in_s + q((newEnd - newStart) * clip.speed));

  // Inverse: restore the pre-images of every clip on the track. Trimming
  // ripples downstream clips, and position-arithmetic inverses are not
  // byte-exact across irrational speeds; pre-image restoration is (ADR-0013).
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

  return {
    timeline: next,
    inverse,
    created: { clip_ids: [], caption_ids: [], effect_ids: [] },
    snaps,
  };
}
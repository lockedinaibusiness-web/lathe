/**
 * trim: move a clip's in/out points; ripple downstream by default (#5).
 * Inverse: trim back to the recorded bounds (exact policy).
 */

import type { Operation, SnapReport } from "@lathe/schemas";
import { seconds } from "@lathe/schemas";
import { type Timeline, clipEnd, rippleTrack } from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure, buildOp, needClip, snapTime, EXACT_POLICY, minClipLength } from "./ops-helpers.js";

export function applyTrim(t: Timeline, op: Operation & { type: "trim" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const snaps: SnapReport[] = [];
  const policy = op.params.snap_policy;

  const oldStart = clip.start_s;
  const oldEnd = clipEnd(clip);

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
  if (newStart < oldStart - 1e-9 && clip.source_in_s <= 0) {
    throw new OpFailure(
      "OP_INVALID_PARAMS",
      "trim in cannot extend past the start of the source media",
      "params.in",
      op.id,
    );
  }
  if (newEnd > oldEnd + 1e-9) {
    const sourceRoom = (clip.source_out_s - clip.source_in_s) / clip.speed - (oldEnd - oldStart);
    if (newEnd - oldEnd > sourceRoom + 1e-9) {
      throw new OpFailure(
        "OP_INVALID_PARAMS",
        "trim out cannot extend past the end of the source media",
        "params.out",
        op.id,
      );
    }
  }

  const delta = newEnd - oldEnd;
  const next = rippleTrack(t, clip.track_id, oldEnd, op.params.ripple ? delta : 0, clip.id);
  const c = next.clips[clip.id]!;
  c.start_s = newStart;
  c.source_in_s = clip.source_in_s + (newStart - oldStart) * clip.speed;
  c.source_out_s = c.source_in_s + (newEnd - newStart) * clip.speed;

  const inverse: Operation[] = [
    buildOp(
      {
        type: "trim",
        target: { clip_id: clip.id },
        params: { side: "both", in: seconds(oldStart), out: seconds(oldEnd), ripple: op.params.ripple, snap_policy: EXACT_POLICY },
        rationale: `restore bounds of ${clip.id}`,
      },
      ctx,
    ),
  ];

  return {
    timeline: next,
    inverse,
    created: { clip_ids: [], caption_ids: [], effect_ids: [] },
    snaps,
  };
}
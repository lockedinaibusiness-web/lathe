/**
 * add_overlay / remove_overlay. Overlays are clip-scoped effects with a time
 * range; the inverse removes the effect by ID (or recreates it exactly).
 */

import type { Operation, SnapReport } from "@lathe/schemas";
import { type Timeline, cloneTimeline, type Overlay } from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure, buildOp, needClip, snapTime, mintId } from "./ops-helpers.js";

export function applyAddOverlay(t: Timeline, op: Operation & { type: "add_overlay" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const snaps: SnapReport[] = [];

  if ((op.params.kind === "image" || op.params.kind === "video" || op.params.kind === "logo") && !op.params.asset_id) {
    throw new OpFailure("OP_INVALID_PARAMS", `${op.params.kind} overlays require asset_id`, "params.asset_id", op.id);
  }
  if (op.params.kind === "text" && !op.params.text) {
    throw new OpFailure("OP_INVALID_PARAMS", "text overlays require text", "params.text", op.id);
  }

  const fromRes = snapTime(op.id, op.params.from, t, ctx);
  const toRes = snapTime(op.id, op.params.to, t, ctx);
  snaps.push(fromRes.report, toRes.report);
  if (!(toRes.applied_s > fromRes.applied_s)) {
    throw new OpFailure("OP_INVALID_PARAMS", "overlay range is empty", "params.to", op.id);
  }

  const effectId = mintId(ctx, "efx");
  const overlay: Overlay = {
    id: effectId,
    kind: op.params.kind,
    ...(op.params.asset_id ? { asset_id: op.params.asset_id } : {}),
    ...(op.params.text ? { text: op.params.text } : {}),
    from_s: fromRes.applied_s,
    to_s: toRes.applied_s,
    ...(op.params.position ? { position: op.params.position } : {}),
    ...(op.params.scale !== undefined ? { scale: op.params.scale } : {}),
    opacity: op.params.opacity,
  };

  const next = cloneTimeline(t);
  next.clips[clip.id]!.overlays.push(overlay);

  const inverse: Operation[] = [
    buildOp(
      {
        type: "remove_overlay",
        target: { clip_id: clip.id, effect_id: effectId },
        params: {},
        rationale: `remove overlay ${effectId}`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [effectId] }, snaps };
}

export function applyRemoveOverlay(t: Timeline, op: Operation & { type: "remove_overlay" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const overlay = clip.overlays.find((o) => o.id === op.target.effect_id);
  if (!overlay) {
    throw new OpFailure("OP_TARGET_NOT_FOUND", `overlay ${op.target.effect_id} not on clip ${clip.id}`, "target.effect_id", op.id);
  }

  const next = cloneTimeline(t);
  next.clips[clip.id]!.overlays = next.clips[clip.id]!.overlays.filter((o) => o.id !== op.target.effect_id);

  const inverse: Operation[] = [
    buildOp(
      {
        type: "add_overlay",
        target: { clip_id: clip.id },
        params: {
          kind: overlay.kind,
          ...(overlay.asset_id ? { asset_id: overlay.asset_id } : {}),
          ...(overlay.text ? { text: overlay.text } : {}),
          // Clip-edge references resolve exactly (no snap policy needed).
          from: { kind: "clip", clip_id: clip.id, edge: "in", offset_s: overlay.from_s - clip.start_s },
          to: { kind: "clip", clip_id: clip.id, edge: "in", offset_s: overlay.to_s - clip.start_s },
          ...(overlay.position ? { position: overlay.position } : {}),
          ...(overlay.scale !== undefined ? { scale: overlay.scale } : {}),
          opacity: overlay.opacity,
        },
        rationale: `restore overlay ${overlay.id}`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}
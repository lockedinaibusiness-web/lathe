/**
 * reframe / zoom / add_transition: absolute visual state on a clip.
 * Inverses restore the recorded prior values exactly (reset / 'none').
 */

import type { Operation, SnapReport } from "@lathe/schemas";
import { type Timeline, cloneTimeline } from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure, buildOp, EXACT_POLICY, needClip, snapTime } from "./ops-helpers.js";
import type { Reframe, Zoom, Transition } from "./timeline.js";

export function applyReframe(t: Timeline, op: Operation & { type: "reframe" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const prior = clip.reframe;
  if (op.params.reset === false && op.params.aspect === "custom" && !(op.params.custom_w && op.params.custom_h)) {
    throw new OpFailure(
      "OP_INVALID_PARAMS",
      "custom reframe requires custom_w and custom_h",
      "params",
      op.id,
    );
  }
  const next = cloneTimeline(t);
  const c = next.clips[clip.id]!;
  if (op.params.reset) {
    c.reframe = null;
  } else {
    const reframe: Reframe = {
      aspect: op.params.aspect,
      mode: op.params.mode,
      smoothing_s: op.params.smoothing_s,
      zoom: op.params.zoom,
      ...(op.params.custom_w ? { custom_w: op.params.custom_w } : {}),
      ...(op.params.custom_h ? { custom_h: op.params.custom_h } : {}),
      ...(op.params.offset_x !== undefined ? { offset_x: op.params.offset_x } : {}),
      ...(op.params.offset_y !== undefined ? { offset_y: op.params.offset_y } : {}),
    };
    c.reframe = reframe;
  }

  const inverse: Operation[] = [
    buildOp(
      {
        type: "reframe",
        target: { clip_id: clip.id },
        params: prior
          ? {
              aspect: prior.aspect,
              mode: prior.mode,
              smoothing_s: prior.smoothing_s,
              zoom: prior.zoom,
              ...(prior.custom_w ? { custom_w: prior.custom_w } : {}),
              ...(prior.custom_h ? { custom_h: prior.custom_h } : {}),
              ...(prior.offset_x !== undefined ? { offset_x: prior.offset_x } : {}),
              ...(prior.offset_y !== undefined ? { offset_y: prior.offset_y } : {}),
            }
          : { aspect: "16:9", reset: true },
        rationale: `restore reframe of ${clip.id}`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}

export function applyZoom(t: Timeline, op: Operation & { type: "zoom" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const prior = clip.zoom;
  const snaps: SnapReport[] = [];

  // from/to are TimeSpecs; resolve them (exact policy keeps restores stable).
  let fromS: number | undefined;
  let toS: number | undefined;
  if (!op.params.reset) {
    if (op.params.from) {
      const r = snapTime(op.id, op.params.from, t, ctx, EXACT_POLICY);
      fromS = r.applied_s;
      snaps.push(r.report);
    }
    if (op.params.to) {
      const r = snapTime(op.id, op.params.to, t, ctx, EXACT_POLICY);
      toS = r.applied_s;
      snaps.push(r.report);
    }
  }

  const next = cloneTimeline(t);
  const c = next.clips[clip.id]!;
  if (op.params.reset) {
    c.zoom = null;
  } else {
    const zoom: Zoom = {
      scale: op.params.scale,
      ease: op.params.ease,
      ...(op.params.anchor ? { anchor: op.params.anchor } : {}),
      ...(fromS !== undefined ? { from_s: fromS } : {}),
      ...(toS !== undefined ? { to_s: toS } : {}),
    };
    c.zoom = zoom;
  }

  const inverse: Operation[] = [
    buildOp(
      {
        type: "zoom",
        target: { clip_id: clip.id },
        params: prior
          ? {
              scale: prior.scale,
              ease: prior.ease,
              ...(prior.anchor ? { anchor: prior.anchor } : {}),
              ...(prior.from_s !== undefined ? { from: { kind: "seconds" as const, seconds: prior.from_s } } : {}),
              ...(prior.to_s !== undefined ? { to: { kind: "seconds" as const, seconds: prior.to_s } } : {}),
            }
          : { scale: 1, reset: true },
        rationale: `restore zoom of ${clip.id}`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps };
}

export function applyTransition(t: Timeline, op: Operation & { type: "add_transition" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const prior: Transition = clip.transition ?? null;
  const next = cloneTimeline(t);
  const c = next.clips[clip.id]!;
  c.transition = op.params.kind === "none" ? null : { kind: op.params.kind, duration_s: op.params.duration_s };

  const inverse: Operation[] = [
    buildOp(
      {
        type: "add_transition",
        target: { clip_id: clip.id },
        params: prior
          ? { kind: prior.kind as "crossfade", duration_s: prior.duration_s }
          : { kind: "none", duration_s: 0 },
        rationale: `restore transition of ${clip.id}`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}
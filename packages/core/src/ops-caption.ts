/**
 * add_caption / style_caption / remove_caption.
 *
 * Captions ride a dedicated caption track (created lazily) and carry ABSOLUTE
 * timeline seconds. add_caption/remove_caption are inverses; style_caption
 * sets absolute values and restores them exactly.
 */

import type { Operation, SnapReport } from "@lathe/schemas";
import { type Timeline, clipDuration, cloneTimeline, captionTrack } from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure, buildOp, needCaption, needClip, snapTime, mintId } from "./ops-helpers.js";

export function applyAddCaption(t: Timeline, op: Operation & { type: "add_caption" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const snaps: SnapReport[] = [];

  let track = captionTrack(t);
  const next = cloneTimeline(t);
  if (!track) {
    const id = mintId(ctx, "trk");
    next.tracks.push({ id, kind: "caption", name: "Captions", position: next.tracks.length, audio: null, clip_ids: [] });
    track = next.tracks.find((tr) => tr.id === id)!;
  }
  const trackRef = next.tracks.find((tr) => tr.id === track!.id)!;

  const fromRes = op.params.from ? snapTime(op.id, op.params.from, next, ctx) : undefined;
  const toRes = op.params.to ? snapTime(op.id, op.params.to, next, ctx) : undefined;
  if (fromRes) snaps.push(fromRes.report);
  if (toRes) snaps.push(toRes.report);
  const from = fromRes ? fromRes.applied_s : clip.start_s;
  const to = toRes ? toRes.applied_s : clip.start_s + clipDuration(clip);

  if (!(to > from)) {
    throw new OpFailure("OP_INVALID_PARAMS", `caption range ${from}..${to} is empty`, "params.to", op.id);
  }
  if (to > ctx.source.duration_s + 1e-6) {
    throw new OpFailure(
      "OP_INVALID_TIME",
      `caption ends at ${to}s beyond source duration ${ctx.source.duration_s}s`,
      "params.to",
      op.id,
    );
  }

  const captionId = mintId(ctx, "cap");
  next.captions[captionId] = {
    id: captionId,
    track_id: trackRef.id,
    clip_id: clip.id,
    start_s: from,
    end_s: to,
    text: op.params.text,
    ...(op.params.style_id ? { style_id: op.params.style_id } : {}),
    ...(op.params.speaker ? { speaker: op.params.speaker } : {}),
    ...(op.params.language ? { language: op.params.language } : {}),
    ...(op.params.overrides ? { overrides: op.params.overrides } : {}),
  };

  const inverse: Operation[] = [
    buildOp({ type: "remove_caption", target: { caption_id: captionId }, params: {}, rationale: `remove added caption ${captionId}` }, ctx),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [captionId], effect_ids: [] }, snaps };
}

export function applyStyleCaption(t: Timeline, op: Operation & { type: "style_caption" }, ctx: ApplyContext): OpResult {
  const cap = needCaption(t, op.target.caption_id, op.id);
  const priorStyle = cap.style_id ?? null;
  const priorOverrides = cap.overrides ?? null;

  const next = cloneTimeline(t);
  const c = next.captions[cap.id]!;
  if ("style_id" in op.params) c.style_id = op.params.style_id ?? undefined;
  if ("overrides" in op.params) c.overrides = op.params.overrides ? { ...op.params.overrides } : undefined;

  const inverse: Operation[] = [
    buildOp(
      {
        type: "style_caption",
        target: { caption_id: cap.id },
        params: { style_id: priorStyle, overrides: priorOverrides },
        rationale: `restore style of caption ${cap.id}`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}

export function applyRemoveCaption(t: Timeline, op: Operation & { type: "remove_caption" }, ctx: ApplyContext): OpResult {
  const cap = needCaption(t, op.target.caption_id, op.id);
  const clip = needClip(t, cap.clip_id, op.id);
  const next = cloneTimeline(t);
  delete next.captions[cap.id];

  const inverse: Operation[] = [
    buildOp(
      {
        type: "add_caption",
        target: { clip_id: cap.clip_id },
        params: {
          text: cap.text,
          // Clip-edge references resolve exactly (no snap policy needed).
          from: { kind: "clip", clip_id: cap.clip_id, edge: "in", offset_s: cap.start_s - clip.start_s },
          to: { kind: "clip", clip_id: cap.clip_id, edge: "in", offset_s: cap.end_s - clip.start_s },
          ...(cap.style_id ? { style_id: cap.style_id } : {}),
          ...(cap.language ? { language: cap.language } : {}),
          ...(cap.speaker ? { speaker: cap.speaker } : {}),
          ...(cap.overrides ? { overrides: cap.overrides } : {}),
        },
        rationale: `restore removed caption ${cap.id}`,
      },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [], caption_ids: [], effect_ids: [] }, snaps: [] };
}
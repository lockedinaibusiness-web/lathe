/**
 * insert_broll: place a B-roll overlay clip on its own track at a snapped
 * time. Inverse: delete the created clip (B-roll tracks are isolated, so no
 * main-track ripple).
 */

import type { Operation, SnapReport } from "@lathe/schemas";
import { type Timeline, cloneTimeline, q, brollTrack, type Clip } from "./timeline.js";
import { type ApplyContext, type OpResult, buildOp, mintId, snapTime } from "./ops-helpers.js";

export function applyInsertBroll(t: Timeline, op: Operation & { type: "insert_broll" }, ctx: ApplyContext): OpResult {
  const snaps: SnapReport[] = [];
  const atRes = snapTime(op.id, op.target.at, t, ctx);
  snaps.push(atRes.report);

  // Resolve the source: a project asset is concrete; searches and stock
  // resolve at render time (recorded here as a pending segment reference).
  let segmentRef: string;
  let sourceIn = 0;
  let sourceOut = op.params.duration_s;
  if (op.params.source.kind === "project_asset") {
    segmentRef = op.params.source.asset_id;
    sourceIn = op.params.source.in_s ?? 0;
    sourceOut = op.params.source.out_s ?? op.params.duration_s;
  } else if (op.params.source.kind === "project_search") {
    segmentRef = `pending:project_search:${op.params.source.query}`;
  } else {
    segmentRef = `pending:stock:${op.params.source.provider}:${op.params.source.query}`;
  }

  const next = cloneTimeline(t);
  // The B-roll track is virtual (derived from is_broll clips): nothing is
  // added to stored tracks, which keeps insert/delete exactly invertible.
  const trackRef = brollTrack(next);

  const clipId = mintId(ctx, "clp");
  const clip: Clip = {
    id: clipId,
    track_id: trackRef.id,
    segment_id: segmentRef,
    start_s: q(atRes.applied_s),
    source_in_s: sourceIn,
    source_out_s: sourceOut,
    speed: 1,
    reframe: null,
    zoom: null,
    transition: null,
    audio: null,
    overlays: [],
    broll_audio: op.params.audio,
    is_broll: true,
  };
  next.clips[clipId] = clip;
  trackRef.clip_ids.push(clipId);

  const inverse: Operation[] = [
    buildOp(
      { type: "delete", target: { clip_id: clipId }, params: { ripple: false }, rationale: `remove inserted B-roll ${clipId}` },
      ctx,
    ),
  ];

  return { timeline: next, inverse, created: { clip_ids: [clipId], caption_ids: [], effect_ids: [] }, snaps };
}
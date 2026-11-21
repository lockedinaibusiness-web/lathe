/**
 * delete / ripple_delete: remove a clip (and its captions), ripple downstream
 * by default. Inverse: restore_clip with the captured pre-image.
 */

import type { Operation } from "@lathe/schemas";
import { type Timeline, clipDuration, rippleTrack, captionsOf, cloneTimeline } from "./timeline.js";
import {
  type ApplyContext,
  type OpResult,
  buildOp,
  clipPreImage,
  captionPreImage,
  needClip,
} from "./ops-helpers.js";

export function applyDelete(t: Timeline, op: Operation & { type: "delete" | "ripple_delete" }, ctx: ApplyContext): OpResult {
  const clip = needClip(t, op.target.clip_id, op.id);
  const ripple = op.type === "ripple_delete" ? true : op.params.ripple;
  const dur = clipDuration(clip);
  const caps = captionsOf(t, clip.id);

  // Always work on a copy: rippleTrack clones, but ripple:false paths must not
  // mutate the caller's timeline.
  const next = cloneTimeline(ripple ? rippleTrack(t, clip.track_id, clip.start_s, -dur, clip.id) : t);
  const track = next.tracks.find((tr) => tr.id === clip.track_id);
  if (track) track.clip_ids = track.clip_ids.filter((id) => id !== clip.id);
  delete next.clips[clip.id];
  for (const cap of caps) delete next.captions[cap.id];

  const inverse: Operation[] = [
    buildOp(
      {
        type: "restore_clip",
        target: { track_id: clip.track_id },
        params: {
          clip: clipPreImage(clip),
          captions: caps.map(captionPreImage),
          at_s: clip.start_s,
          ripple,
        },
        rationale: `restore deleted clip ${clip.id}`,
      },
      ctx,
    ),
  ];

  return {
    timeline: next,
    inverse,
    created: { clip_ids: [], caption_ids: [], effect_ids: [] },
    snaps: [],
  };
}
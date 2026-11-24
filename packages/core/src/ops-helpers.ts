/**
 * Shared machinery for the operations engine: failures, the apply context,
 * snapping wrappers, and inverse-op builders. Pure, zero I/O.
 */

import {
  DEFAULT_SNAP_POLICY,
  errorDef,
  type ErrorCode,
  type Operation,
  type OperationId,
  type SnapPolicy,
  type SnapReport,
  type IdPrefix,
} from "@lathe/schemas";
import {
  type Timeline,
  type Clip,
  type Caption,
  getClip,
  getCaption,
  getTrack,
  clipDuration,
  captionsOf,
} from "./timeline.js";
import { resolveAndSnap, SnapError, type SourceIndex } from "./snap.js";

/** Structured failure carrying a catalog code (used by apply_edits). */
export class OpFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly field?: string,
    readonly opId?: OperationId,
  ) {
    super(message);
    this.name = "OpFailure";
  }
  get suggested_fix(): string {
    return errorDef(this.code).suggested_fix;
  }
}

/** Injected services: source index, ID minting, and the acting identity. */
export interface ApplyContext {
  source: SourceIndex;
  /** ID minting; defaults to the schema generator. Injected for determinism. */
  mint?: (prefix: IdPrefix) => string;
  actor: string;
}

/** What an applied operation yields: the new timeline, its structural
 * inverse (invariant #2), anything it created, and snap reports (#1). */
export interface OpResult {
  timeline: Timeline;
  inverse: Operation[];
  created: { clip_ids: string[]; caption_ids: string[]; effect_ids: string[] };
  snaps: SnapReport[];
}

export function mintId(ctx: ApplyContext, prefix: IdPrefix): string {
  if (ctx.mint) return ctx.mint(prefix);
  // Deterministic-ish fallback without importing the RNG-heavy generator.
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

export function needClip(t: Timeline, id: string, opId: OperationId): Clip {
  const clip = getClip(t, id);
  if (!clip) {
    throw new OpFailure("OP_TARGET_NOT_FOUND", `clip ${id} does not exist`, "target.clip_id", opId);
  }
  return clip;
}

export function needCaption(t: Timeline, id: string, opId: OperationId): Caption {
  const cap = getCaption(t, id);
  if (!cap) {
    throw new OpFailure("OP_TARGET_NOT_FOUND", `caption ${id} does not exist`, "target.caption_id", opId);
  }
  return cap;
}

export function needTrack(t: Timeline, id: string, opId: OperationId) {
  const track = getTrack(t, id);
  if (!track) {
    throw new OpFailure("OP_TARGET_NOT_FOUND", `track ${id} does not exist`, "target.track_id", opId);
  }
  return track;
}

/**
 * Resolve + snap a TimeSpec under the operation's snap policy (or the exact
 * policy used by engine inverses). Converts SnapError into OpFailure.
 */
export function snapTime(
  opId: OperationId,
  spec: Parameters<typeof resolveAndSnap>[1],
  t: Timeline,
  ctx: ApplyContext,
  policy: SnapPolicy = DEFAULT_SNAP_POLICY,
): { applied_s: number; report: SnapReport } {
  try {
    return resolveAndSnap(opId, spec, t, ctx.source, policy);
  } catch (err) {
    if (err instanceof SnapError) {
      throw new OpFailure(err.code, err.message, err.field, opId);
    }
    throw err;
  }
}

/** Clip IDs on a REAL track (virtual B-roll has no stored track). */
export function realTrackClipIds(t: Timeline, trackId: string): string[] {
  return t.tracks.find((tr) => tr.id === trackId)?.clip_ids ?? [];
}

/** The policy inverses use: no snapping, exact restoration (ADR-0013). */
export const EXACT_POLICY: SnapPolicy = {
  avoid_mid_word: false,
  prefer_silence: false,
  tolerance_ms: 1_000_000_000,
  pause_inset_ms: 0,
};

/** Minimum clip length: one frame at the source frame rate. */
export function minClipLength(ctx: ApplyContext): number {
  return 1 / (ctx.source.fps ?? 30);
}

export function clipEndOf(clip: Clip): number {
  return clip.start_s + clipDuration(clip);
}

export { captionsOf };

/** Shape of a clip as stored in a restore_clip pre-image. B-roll clips carry
 * their source key in asset_ref (not segment_id) so the pre-image validates
 * against the operations contract. */
export function clipPreImage(clip: Clip): Record<string, unknown> {
  const json = JSON.parse(JSON.stringify(clip)) as Record<string, unknown>;
  if (clip.is_broll) {
    json.asset_ref = clip.segment_id;
    delete json.segment_id;
  }
  return json;
}

export function captionPreImage(cap: Caption): Record<string, unknown> {
  return JSON.parse(JSON.stringify(cap)) as Record<string, unknown>;
}

/**
 * Build an operation with engine defaults filled in. The engine constructs
 * inverses as plain objects (the public op shapes) and validates them through
 * applyOperation's schema check on the way back in.
 */
export function buildOp(op: Record<string, unknown>, ctx: ApplyContext): Operation {
  return {
    id: (op.id as OperationId | undefined) ?? mintId(ctx, "op"),
    group_id: (op.group_id as string | undefined) ?? mintId(ctx, "grp"),
    rationale: (op.rationale as string | undefined) ?? "engine inverse",
    ...op,
  } as unknown as Operation;
}
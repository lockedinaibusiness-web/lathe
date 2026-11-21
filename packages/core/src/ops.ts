/**
 * applyOperation: the single entry point the batch layer, the API, and the
 * MCP server use. Validates the operation, applies it to a COPY of the
 * timeline, and returns the structural inverse (invariant #2).
 */

import type { Operation } from "@lathe/schemas";
import { Operation as OperationSchema } from "@lathe/schemas";
import type { Timeline } from "./timeline.js";
import { type ApplyContext, type OpResult, OpFailure } from "./ops-helpers.js";
import { applySplit } from "./ops-split.js";
import { applyTrim } from "./ops-trim.js";
import { applyDelete } from "./ops-delete.js";
import { applyReorder, applySetSpeed, applyRestoreClip } from "./ops-arrange.js";
import { applyReframe, applyZoom, applyTransition } from "./ops-visual.js";
import { applyAddCaption, applyStyleCaption, applyRemoveCaption } from "./ops-caption.js";
import { applyAddOverlay, applyRemoveOverlay } from "./ops-overlay.js";
import { applySetGain, applyDuckAudio, applyNormalizeAudio } from "./ops-audio.js";
import { applyInsertBroll } from "./ops-broll.js";

export { OpFailure };
export type { ApplyContext, OpResult };

/** Handlers per operation type (exhaustive by construction). */
const HANDLERS: {
  [K in Operation["type"]]: (
    t: Timeline,
    op: Extract<Operation, { type: K }>,
    ctx: ApplyContext,
  ) => OpResult;
} = {
  split: applySplit,
  trim: applyTrim,
  delete: applyDelete,
  ripple_delete: applyDelete,
  reorder: applyReorder,
  set_speed: applySetSpeed,
  reframe: applyReframe,
  zoom: applyZoom,
  add_transition: applyTransition,
  add_caption: applyAddCaption,
  style_caption: applyStyleCaption,
  add_overlay: applyAddOverlay,
  set_gain: applySetGain,
  duck_audio: applyDuckAudio,
  normalize_audio: applyNormalizeAudio,
  insert_broll: applyInsertBroll,
  restore_clip: applyRestoreClip,
  remove_caption: applyRemoveCaption,
  remove_overlay: applyRemoveOverlay,
};

/**
 * Apply one operation. The input timeline is never mutated. Throws OpFailure
 * (with a catalog code) on validation errors.
 */
export function applyOperation(t: Timeline, op: Operation, ctx: ApplyContext): OpResult {
  // Re-validate: the engine is a trust boundary for callers (API/MCP), and
  // property tests may hand raw objects.
  const parsed = OperationSchema.safeParse(op);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new OpFailure(
      "OP_INVALID_PARAMS",
      `operation failed schema validation: ${issue?.message ?? "unknown"} at ${issue?.path.join(".") ?? "?"}`,
      issue?.path.join("."),
      (op as { id?: string }).id,
    );
  }
  const handler = HANDLERS[parsed.data.type];
  if (!handler) {
    throw new OpFailure("OP_INVALID_PARAMS", `no handler for ${parsed.data.type}`, "type", parsed.data.id);
  }
  // @ts-expect-error handler union is exhaustive; the cast keeps dispatch cheap
  return handler(t, parsed.data, ctx);
}

/** Apply a list of operations in order (used by undo/redo of stored batches). */
export function applyOperations(t: Timeline, ops: Operation[], ctx: ApplyContext): { timeline: Timeline; inverses: Operation[][] } {
  let current = t;
  const inverses: Operation[][] = [];
  for (const op of ops) {
    const r = applyOperation(current, op, ctx);
    current = r.timeline;
    inverses.push(r.inverse);
  }
  return { timeline: current, inverses };
}
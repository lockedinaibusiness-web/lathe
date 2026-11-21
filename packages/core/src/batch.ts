/**
 * Atomic batches (invariant #3) and undo/redo (EDT-6).
 *
 * applyBatch simulates every operation against the working timeline; if any
 * operation fails, NOTHING is applied and the response reports per-operation
 * results plus batch-level conflicts. No partial application, ever.
 */

import type { Operation } from "@lathe/schemas";
import { MAX_BATCH_OPS } from "@lathe/schemas";
import type { Timeline } from "./timeline.js";
import { type ApplyContext, OpFailure, applyOperation } from "./ops.js";

export interface OperationOutcome {
  op_id: string;
  ok: boolean;
  snaps?: unknown[];
  created?: { clip_ids?: string[]; caption_ids?: string[] };
  error?: { code: string; message: string; suggested_fix: string; field?: string };
}

export interface BatchOutcome {
  batch_id: string;
  previous_version: number;
  new_version: number;
  applied: boolean;
  results: OperationOutcome[];
  conflicts: { code: string; op_ids: string[]; message: string; suggested_fix: string }[];
  summary: string;
  /** Set when applied: the inverse batch to restore the previous state. */
  inverse: Operation[];
  /** Set when applied: per-op inverses in application order. */
  per_op_inverses: Operation[][];
}

export interface ApplyBatchRequest {
  timeline: Timeline;
  operations: Operation[];
  /** Optimistic concurrency: the version the batch was planned against. */
  base_version: number;
  dry_run?: boolean;
  mint?: (prefix: "btc" | "grp" | "op" | "clp" | "cap" | "efx" | "trk") => string;
}

export function applyBatch(req: ApplyBatchRequest, ctx: ApplyContext): BatchOutcome {
  const { timeline, operations, base_version } = req;
  const batchId = req.mint ? req.mint("btc") : `btc_${Math.random().toString(36).slice(2, 14)}`;

  if (operations.length > MAX_BATCH_OPS) {
    return {
      batch_id: batchId,
      previous_version: timeline.version,
      new_version: timeline.version,
      applied: false,
      results: [],
      conflicts: [
        {
          code: "BATCH_TOO_LARGE",
          op_ids: [],
          message: `batch has ${operations.length} operations; the limit is ${MAX_BATCH_OPS}`,
          suggested_fix: "Split into multiple apply_edits calls of at most 500 operations each.",
        },
      ],
      summary: `Rejected: ${operations.length} operations exceeds the ${MAX_BATCH_OPS}-op limit.`,
      inverse: [],
      per_op_inverses: [],
    };
  }
  if (base_version !== timeline.version) {
    return {
      batch_id: batchId,
      previous_version: timeline.version,
      new_version: timeline.version,
      applied: false,
      results: [],
      conflicts: [
        {
          code: "VERSION_CONFLICT",
          op_ids: [],
          message: `base_version ${base_version} does not match timeline version ${timeline.version}`,
          suggested_fix: "Re-read the timeline version, rebase the plan, and resubmit.",
        },
      ],
      summary: `Rejected: version conflict (base ${base_version}, current ${timeline.version}).`,
      inverse: [],
      per_op_inverses: [],
    };
  }

  // Simulate on a working copy. Any failure aborts the whole batch.
  let working = timeline;
  const results: OperationOutcome[] = [];
  const perOpInverses: Operation[][] = [];
  const created: { clip_ids: string[]; caption_ids: string[] } = { clip_ids: [], caption_ids: [] };

  for (const op of operations) {
    try {
      const outcome = applyOperation(working, op, ctx);
      working = outcome.timeline;
      perOpInverses.push(outcome.inverse);
      created.clip_ids.push(...(outcome.created.clip_ids ?? []));
      created.caption_ids.push(...(outcome.created.caption_ids ?? []));
      results.push({
        op_id: op.id,
        ok: true,
        ...(outcome.snaps.length > 0 ? { snaps: outcome.snaps } : {}),
        created: outcome.created,
      });
    } catch (err) {
      if (err instanceof OpFailure) {
        results.push({
          op_id: (op as { id?: string }).id ?? "?",
          ok: false,
          error: { code: err.code, message: err.message, suggested_fix: err.suggested_fix, ...(err.field ? { field: err.field } : {}) },
        });
      } else {
        results.push({
          op_id: (op as { id?: string }).id ?? "?",
          ok: false,
          error: { code: "OP_INVALID_PARAMS", message: String(err), suggested_fix: "Check the operation shape against the schema." },
        });
      }
      // Atomic: stop and reject. No partial application (invariant #3).
      return {
        batch_id: batchId,
        previous_version: timeline.version,
        new_version: timeline.version,
        applied: false,
        results,
        conflicts: [],
        summary: `Rejected at operation ${results.length} of ${operations.length}; nothing was applied.`,
        inverse: [],
        per_op_inverses: [],
      };
    }
  }

  if (req.dry_run) {
    return {
      batch_id: batchId,
      previous_version: timeline.version,
      new_version: timeline.version,
      applied: false,
      results,
      conflicts: [],
      summary: `Dry run: ${operations.length} operations validated; nothing was applied.`,
      inverse: [],
      per_op_inverses: [],
    };
  }

  // Commit: bump the version and fold the per-op inverses into one batch
  // inverse, applied in reverse order on undo (LIFO).
  const finalTimeline: Timeline = { ...working, version: timeline.version + 1 };
  const batchInverse: Operation[] = [];
  for (let i = perOpInverses.length - 1; i >= 0; i--) {
    batchInverse.push(...perOpInverses[i]!);
  }

  return {
    batch_id: batchId,
    previous_version: timeline.version,
    new_version: finalTimeline.version,
    applied: true,
    results,
    conflicts: [],
    summary: `Applied ${operations.length} operations atomically; timeline v${timeline.version} -> v${finalTimeline.version}.`,
    inverse: batchInverse,
    per_op_inverses: perOpInverses,
  };
}
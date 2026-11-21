/**
 * Undo/redo history (EDT-6): every applied batch is one labeled, groupable,
 * reversible entry. Undo applies the stored inverse batch; redo re-applies the
 * original operations.
 *
 * History is linear (like an NLE): you can only undo the most recent
 * non-undone entry directly; undoing an older group after newer changes
 * requires undoing the newer ones first. This keeps every state on the stack
 * reproducible.
 */

import type { Operation } from "@lathe/schemas";
import type { Timeline } from "./timeline.js";
import { type ApplyContext, applyOperations } from "./ops.js";

export interface HistoryEntry {
  batch_id: string;
  group_ids: string[];
  actor: string;
  /** The applied operations (for redo). */
  ops: Operation[];
  /** The inverse batch (for undo), already in LIFO application order. */
  inverse: Operation[];
  base_version: number;
  new_version: number;
  /** One-line label shown in the review UI (from the batch rationale). */
  label: string;
  undone: boolean;
  created_at_ms: number;
}

export class HistoryError extends Error {
  constructor(
    readonly code: "VERSION_CONFLICT" | "OP_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "HistoryError";
  }
}

export class EditHistory {
  private entries: HistoryEntry[] = [];

  constructor(private timeline: Timeline) {}

  get current(): Timeline {
    return this.timeline;
  }

  get log(): readonly HistoryEntry[] {
    return this.entries;
  }

  /** Record a committed batch (from applyBatch with applied: true). */
  commit(entry: Omit<HistoryEntry, "undone" | "created_at_ms">, timeline: Timeline, nowMs = Date.now()): void {
    this.timeline = timeline;
    this.entries.push({ ...entry, undone: false, created_at_ms: nowMs });
  }

  /** Most recent non-undone entry (null when fully undone). */
  private latest(): HistoryEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (!this.entries[i]!.undone) return this.entries[i];
    }
    return undefined;
  }

  private find(kind: "group" | "batch", id: string): HistoryEntry | undefined {
    const latest = this.latest();
    if (!latest) return undefined;
    if (kind === "batch") return latest.batch_id === id ? latest : undefined;
    return latest.group_ids.includes(id) ? latest : undefined;
  }

  /** Undo the most recent entry, or a specific group/batch if it is the most recent. */
  undo(
    target: { kind: "last"; count: number } | { kind: "group"; group_id: string } | { kind: "batch"; batch_id: string },
    ctx: ApplyContext,
  ): { entry: HistoryEntry; timeline: Timeline; reverted_op_ids: string[]; new_version: number } {
    let count = 1;
    if (target.kind === "last") count = target.count;
    const latest = this.latest();
    if (!latest) throw new HistoryError("OP_CONFLICT", "nothing to undo");
    if (target.kind !== "last") {
      const entry = this.find(target.kind, target.kind === "group" ? target.group_id : target.batch_id);
      if (!entry) {
        throw new HistoryError(
          "OP_CONFLICT",
          target.kind === "group"
            ? `group ${target.group_id} is not the most recent change; undo newer changes first`
            : `batch ${target.batch_id} is not the most recent change; undo newer changes first`,
        );
      }
    }

    const toUndo: HistoryEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && toUndo.length < count; i--) {
      const entry = this.entries[i]!;
      if (!entry.undone) toUndo.push(entry);
    }
    if (toUndo.length === 0) throw new HistoryError("OP_CONFLICT", "nothing to undo");

    let timeline = this.timeline;
    const reverted: string[] = [];
    for (const entry of toUndo) {
      const { timeline: next } = applyOperations(timeline, entry.inverse, ctx);
      timeline = { ...next, version: timeline.version + 1 };
      entry.undone = true;
      reverted.push(...entry.ops.map((o) => o.id));
    }
    this.timeline = timeline;
    const primary = toUndo[0]!;
    return { entry: primary, timeline, reverted_op_ids: reverted, new_version: timeline.version };
  }

  /** Redo the most recently undone entry (or a specific one). */
  redo(
    target: { kind: "last"; count: number } | { kind: "group"; group_id: string } | { kind: "batch"; batch_id: string },
    ctx: ApplyContext,
  ): { entry: HistoryEntry; timeline: Timeline; new_version: number } {
    let candidates: HistoryEntry[];
    if (target.kind === "last") {
      candidates = [];
      for (let i = this.entries.length - 1; i >= 0 && candidates.length < target.count; i--) {
        if (this.entries[i]!.undone) candidates.push(this.entries[i]!);
      }
      candidates = candidates.reverse(); // redo in original order
    } else {
      const id = target.kind === "group" ? target.group_id : target.batch_id;
      const entry = this.entries.find((e) => e.undone && (target.kind === "group" ? e.group_ids.includes(id) : e.batch_id === id));
      if (!entry) throw new HistoryError("OP_CONFLICT", `no undone ${target.kind} ${id}`);
      candidates = [entry];
    }
    if (candidates.length === 0) throw new HistoryError("OP_CONFLICT", "nothing to redo");

    let timeline = this.timeline;
    for (const entry of candidates) {
      const { timeline: next } = applyOperations(timeline, entry.ops, ctx);
      timeline = { ...next, version: timeline.version + 1 };
      entry.undone = false;
    }
    this.timeline = timeline;
    const primary = candidates[candidates.length - 1]!;
    return { entry: primary, timeline, new_version: timeline.version };
  }
}
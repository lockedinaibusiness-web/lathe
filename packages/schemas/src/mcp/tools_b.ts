/**
 * MCP tool definitions, part B: editing tools.
 */

import { z } from "zod";
import { defineTool, type McpToolDef } from "./registry.js";
import { Summary } from "../common.js";
import { BatchId, GroupId, ProjectId } from "../ids.js";
import { ApplyEditsRequest, ApplyEditsResponse, UndoRedoResponse } from "../operations.js";

export const applyEditsTool: McpToolDef = defineTool({
  name: "apply_edits",
  title: "Apply edits",
  description:
    "Apply a batch of 1-500 operations atomically. All operations validate first; if any fails the whole batch is rejected and nothing changes. Operations reference stable segment/clip IDs from the Brief - never invent IDs, never use raw timestamps where a word reference exists. Every operation needs a one-line rationale and a group_id so the batch appears as one labeled, undoable change in the review UI. Raw timecodes are accepted but get snapped; read the per-operation snap reports to see where cuts actually landed.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: [
    "AUTH_REQUIRED",
    "PROJECT_NOT_FOUND",
    "SCOPE_DENIED",
    "VERSION_CONFLICT",
    "BATCH_TOO_LARGE",
    "OP_TARGET_NOT_FOUND",
    "OP_INVALID_TIME",
    "OP_SNAP_AMBIGUOUS",
    "OP_INVALID_PARAMS",
    "OP_CONFLICT",
    "IDEMPOTENCY_REUSED",
  ],
  examples: [
    {
      title: "Trim a tangent and ripple the rest",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        base_version: 7,
        idempotency_key: "batch_2026-11-21_01",
        actor: "model:claude-sonnet-4-5@anthropic",
        operations: [
          {
            id: "op_01J8ZQ4K2M9T3X7YB6N0PWAAAA",
            type: "trim",
            group_id: "grp_01J8ZQ4K2M9T3X7YB6N0PWAAAA",
            target: { clip_id: "clp_01J8ZQ4K2M9T3X7YB6N0PWAAAA" },
            params: { side: "out", out: { kind: "word", segment_id: "seg_01J8ZQ4K2M9T3X7YB6N0PWAAAA", word_index: 42 } },
            rationale: "Cut tangent about ad pricing; next sentence starts the main story.",
          },
        ],
      },
      output_summary:
        "Applied 1 operation. Timeline v7 -> v8. Cut snapped to word 42 end (delta 12 ms inside pause).",
    },
    {
      title: "Batch: split, delete filler, normalize audio",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        base_version: 8,
        idempotency_key: "batch_2026-11-21_02",
        actor: "model:claude-sonnet-4-5@anthropic",
        operations: [
          {
            id: "op_01J8ZQ4K2M9T3X7YB6N0PWBBBB",
            type: "split",
            group_id: "grp_01J8ZQ4K2M9T3X7YB6N0PWBBBB",
            target: { clip_id: "clp_01J8ZQ4K2M9T3X7YB6N0PWBBBB", at: { kind: "word", segment_id: "seg_01J8ZQ4K2M9T3X7YB6N0PWBBBB", word_index: 15 } },
            params: {},
            rationale: "Split off the intro so I can tighten its pacing.",
          },
          {
            id: "op_01J8ZQ4K2M9T3X7YB6N0PWCCCC",
            type: "normalize_audio",
            group_id: "grp_01J8ZQ4K2M9T3X7YB6N0PWBBBB",
            target: { scope: "project" },
            params: { target_lufs: -16, true_peak_dbtp: -1 },
            rationale: "Podcast clean loudness target.",
          },
        ],
      },
      output_summary: "Applied 2 operations atomically. Timeline v8 -> v9. New clip clp_... created by split.",
    },
  ],
  input: ApplyEditsRequest,
  output: z.object({
    batch_id: BatchId,
    previous_version: z.number().int().nonnegative(),
    new_version: z.number().int().nonnegative(),
    results: ApplyEditsResponse.shape.results,
    conflicts: ApplyEditsResponse.shape.conflicts,
    summary: Summary,
  }),
});

export const removeFillersTool: McpToolDef = defineTool({
  name: "remove_fillers",
  title: "Remove fillers",
  description:
    "Transcript-aware removal of filler words (um, uh, er, 'you know' clusters) and over-long pauses. Words are removed at word boundaries with natural breaths kept, so cuts never land mid-word. Aggressiveness 0 = only remove flagged fillers; 1 = also collapse every pause above the style's max_pause_s. Returns the operations as a plan when apply is false, or applies them as one grouped batch when apply is true.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: [
    "AUTH_REQUIRED",
    "PROJECT_NOT_FOUND",
    "BRIEF_NOT_READY",
    "VERSION_CONFLICT",
    "OP_TARGET_NOT_FOUND",
  ],
  examples: [
    {
      title: "Standard podcast filler removal",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        aggressiveness: 0.7,
        max_pause_s: 0.6,
        apply: true,
        base_version: 12,
        idempotency_key: "fillers_2026-11-21_01",
      },
      output_summary:
        "Removed 84 fillers and 31 long pauses (-6:12). Cuts landed in pauses; timeline v12 -> v13.",
    },
    {
      title: "Dry run: see the plan first",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        aggressiveness: 0.3,
        max_pause_s: 0.8,
        apply: false,
      },
      output_summary:
        "Plan: 41 trims (12 fillers, 29 pauses >0.8s), estimated -3:48, zero mid-word cuts.",
    },
  ],
  input: z.object({
    project_id: ProjectId,
    aggressiveness: z.number().min(0).max(1).default(0.7),
    max_pause_s: z.number().positive().default(0.6),
    filler_words: z.array(z.string()).default(["um", "uh", "er", "you know", "I mean"]),
    /** false = return the planned operations without applying them. */
    apply: z.boolean().default(true),
    base_version: z.number().int().nonnegative().optional(),
    idempotency_key: z.string().min(8).max(128).optional(),
  }),
  output: z.object({
    applied: z.boolean(),
    batch_id: BatchId.optional(),
    new_version: z.number().int().nonnegative().optional(),
    removed_fillers: z.number().int().nonnegative(),
    removed_pauses: z.number().int().nonnegative(),
    seconds_removed: z.number().nonnegative().finite(),
    operations: z.array(z.record(z.string(), z.unknown())).describe("Planned/applied operations when dry_run"),
    summary: Summary,
  }),
});

export const extractClipsTool: McpToolDef = defineTool({
  name: "extract_clips",
  title: "Extract clips",
  description:
    "Find the N strongest standalone moments in a project and create each as its own clip sequence. Scoring uses energy, hook strength, topic completeness, and (when ready) semantic content. Each extracted clip gets its own segment IDs and is independent on the timeline.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: [
    "AUTH_REQUIRED",
    "PROJECT_NOT_FOUND",
    "BRIEF_NOT_READY",
    "VERSION_CONFLICT",
    "OP_INVALID_PARAMS",
  ],
  examples: [
    {
      title: "Extract 3 clips of 20-60 seconds",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        count: 3,
        min_length_s: 20,
        max_length_s: 60,
        criteria: "balanced",
        apply: true,
        base_version: 3,
        idempotency_key: "clips_2026-11-21_01",
      },
      output_summary:
        "Extracted 3 clips: 03:12-03:58 (hook: 'the mistake that cost us...'), 21:05-21:47, 44:30-45:11. Timeline v3 -> v4.",
    },
    {
      title: "High-energy only, proposal mode",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        count: 5,
        criteria: "energy",
        apply: false,
      },
      output_summary: "5 proposed clips with scores 0.87-0.71, all with strong openers; nothing applied yet.",
    },
  ],
  input: z.object({
    project_id: ProjectId,
    count: z.number().int().min(1).max(50).default(3),
    min_length_s: z.number().positive().default(20),
    max_length_s: z.number().positive().default(60),
    criteria: z.enum(["energy", "content", "balanced", "hook"]).default("balanced"),
    apply: z.boolean().default(true),
    base_version: z.number().int().nonnegative().optional(),
    idempotency_key: z.string().min(8).max(128).optional(),
  }),
  output: z.object({
    applied: z.boolean(),
    batch_id: BatchId.optional(),
    clips: z.array(
      z.object({
        name: z.string(),
        start_s: z.number().nonnegative().finite(),
        end_s: z.number().nonnegative().finite(),
        score: z.number().min(0).max(1),
        reason: z.string(),
        segment_ids: z.array(z.string()),
      }),
    ),
    summary: Summary,
  }),
});

export const undoTool: McpToolDef = defineTool({
  name: "undo",
  title: "Undo",
  description:
    "Revert an operation group or batch to the state before it. Every AI batch is grouped and labeled, so undo restores exactly one planned change - never a partial middle. Use instead of editing over a bad batch. Source media is never deleted by undo.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "VERSION_CONFLICT", "IDEMPOTENCY_REUSED"],
  examples: [
    {
      title: "Undo the last batch",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        target: { kind: "last", count: 1 },
        idempotency_key: "undo_2026-11-21_01",
      },
      output_summary: "Reverted batch btc_... (grp_...: 'Cut tangent about ad pricing'). Timeline v13 -> v12.",
    },
    {
      title: "Undo a specific group by ID",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        target: { kind: "group", group_id: "grp_01J8ZQ4K2M9T3X7YB6N0PWBBBB" },
        idempotency_key: "undo_2026-11-21_02",
      },
      output_summary: "Reverted group grp_... (2 operations). Timeline v9 -> v7.",
    },
  ],
  input: z.object({
    project_id: ProjectId,
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("last"), count: z.number().int().min(1).max(20).default(1) }),
      z.object({ kind: z.literal("group"), group_id: GroupId }),
      z.object({ kind: z.literal("batch"), batch_id: BatchId }),
    ]),
    expected_version: z.number().int().nonnegative().optional(),
    idempotency_key: z.string().min(8).max(128),
  }),
  output: z.object({
    ok: z.boolean(),
    reverted_op_ids: z.array(z.string()),
    new_version: z.number().int().nonnegative(),
    summary: Summary,
  }),
});

export const redoTool: McpToolDef = defineTool({
  name: "redo",
  title: "Redo",
  description:
    "Re-apply an undone operation group. Redo restores the exact operations, including their rationale and grouping. If the timeline changed since the undo, redo fails with VERSION_CONFLICT rather than producing a half-applied state.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "VERSION_CONFLICT", "IDEMPOTENCY_REUSED"],
  examples: [
    {
      title: "Redo the last undone group",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        target: { kind: "last", count: 1 },
        idempotency_key: "redo_2026-11-21_01",
      },
      output_summary: "Re-applied grp_... (84 filler removals). Timeline v12 -> v13.",
    },
    {
      title: "Redo a specific batch",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        target: { kind: "batch", batch_id: "btc_01J8ZQ4K2M9T3X7YB6N0PWAAAA" },
        idempotency_key: "redo_2026-11-21_02",
      },
      output_summary: "Re-applied batch btc_... (2 operations incl. normalization).",
    },
  ],
  input: z.object({
    project_id: ProjectId,
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("last"), count: z.number().int().min(1).max(20).default(1) }),
      z.object({ kind: z.literal("group"), group_id: GroupId }),
      z.object({ kind: z.literal("batch"), batch_id: BatchId }),
    ]),
    expected_version: z.number().int().nonnegative().optional(),
    idempotency_key: z.string().min(8).max(128),
  }),
  output: UndoRedoResponse,
});
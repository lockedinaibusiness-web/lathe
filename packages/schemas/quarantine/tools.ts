import { z } from "zod";
import type { ZodTypeAny } from "zod";
import {
  ApplyEditsResult,
  OpBatch,
  Operation as OperationSchema,
  type Operation,
  OPERATION_TYPES,
} from "./operations.js";
import { Aspect, TimelineVersionInfo } from "./timeline.js";
import { Brief, BriefQuery, BriefReadiness } from "./brief.js";
import { VerifyReport, VerifyRequest } from "./verification.js";
import { StyleListResult } from "./styles.js";
import { Project, CreateProjectRequest } from "./projects.js";
import { JobAccepted, JobStatus } from "./jobs.js";
import { ERROR_CATALOG, ErrorCode } from "./errors.js";
import { LanguageCode, Scope } from "./common.js";
import {
  AssetId,
  JobId,
  OperationGroupId,
  ProjectId,
  sampleId,
  SegmentId,
  ShotId,
  StyleId,
  TrackId,
} from "./ids.js";
import { Ms } from "./time.js";

const ERROR_CODES_SET = new Set<string>(ERROR_CATALOG.map((e) => e.code));

/* ------------------------------------------------------------------ */
/* Sample IDs used by the worked examples (deterministic, spec-valid). */
/* ------------------------------------------------------------------ */

export const SAMPLE = {
  project_id: sampleId("prj", 1),
  asset_id: sampleId("ast", 2),
  seg1: sampleId("seg", 11),
  seg2: sampleId("seg", 12),
  seg3: sampleId("seg", 13),
  shot1: sampleId("sht", 14),
  spk1: sampleId("spk", 15),
  track_v1: sampleId("trk", 21),
  track_a1: sampleId("trk", 22),
  track_c1: sampleId("trk", 23),
  clip1: sampleId("clp", 31),
  clip2: sampleId("clp", 32),
  clip3: sampleId("clp", 33),
  group1: sampleId("grp", 41),
  op1: sampleId("op", 51),
  op2: sampleId("op", 52),
  op3: sampleId("op", 53),
  job1: sampleId("job", 61),
  job2: sampleId("job", 62),
  style_podcast: sampleId("sty", 71),
  cap1: sampleId("cap", 81),
  ups1: sampleId("ups", 91),
  run1: sampleId("run", 95),
  version: { version: 7, hash: "a".repeat(64) } as { version: number; hash: string },
} as const;

/* ------------------------------------------------------------------ */
/* Small tool-specific result schemas                                  */
/* ------------------------------------------------------------------ */

export const UndoResult = z
  .object({
    undone_group_id: OperationGroupId.optional().describe("The operation group that was reverted."),
    version: TimelineVersionInfo.describe("Timeline state after the undo."),
    can_undo: z.boolean(),
    can_redo: z.boolean(),
  })
  .describe("Result of undo.");

export const RedoResult = z
  .object({
    redone_group_id: OperationGroupId.optional(),
    version: TimelineVersionInfo,
    can_undo: z.boolean(),
    can_redo: z.boolean(),
  })
  .describe("Result of redo.");

const AppliedExtra = {
  apply: z
    .boolean()
    .default(false)
    .describe(
      "false (default): return proposed operations for review. true: also apply them atomically via the same apply_edits path.",
    ),
} as const;

const WithApplyResult = {
  apply_result: ApplyEditsResult.optional().describe("Present when apply was true."),
} as const;

/* ------------------------------------------------------------------ */
/* Tool definition type + registry                                     */
/* ------------------------------------------------------------------ */

export interface ToolExample {
  summary: string;
  input: unknown;
  output: unknown;
}

export interface ToolDef {
  name: ToolName;
  title: string;
  description: string;
  mutating: boolean;
  scopes: Scope[];
  errors: ErrorCode[];
  input: ZodTypeAny;
  output: ZodTypeAny;
  examples: ToolExample[];
}

export const TOOL_NAMES = [
  "create_project",
  "get_brief",
  "search_footage",
  "get_frames",
  "list_styles",
  "plan_edit",
  "apply_edits",
  "remove_fillers",
  "extract_clips",
  "add_captions",
  "reframe",
  "audio_cleanup",
  "find_broll",
  "translate",
  "preview",
  "verify",
  "undo",
  "redo",
  "render",
  "export_project",
  "get_status",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const S = SAMPLE;

/** Compact sample Brief used across examples. */
const sampleBrief: unknown = {
  contract_version: "1",
  project_id: S.project_id,
  generated_ms: 1700000000000,
  duration_ms: 120000,
  detail: "standard",
  readiness: { transcript: "ready", speakers: "ready", shots: "pending", audio: "ready", visual: "pending" },
  speakers: [{ id: S.spk1, label: "Speaker 1" }],
  segments: [
    {
      id: S.seg1,
      start_ms: 1000,
      end_ms: 6000,
      speaker: S.spk1,
      text: "Welcome back to the show. Um, today we talk about coffee.",
      shot_id: S.shot1,
      words: [
        { w: "Welcome", s: 1000, e: 1400, c: 0.98 },
        { w: "um", s: 4400, e: 4600, c: 0.9 },
      ],
    },
    { id: S.seg2, start_ms: 8000, end_ms: 14000, speaker: S.spk1, text: "First, the beans matter more than the machine." },
  ],
  audio: { silences: [{ s: 6000, e: 8000 }], loudness_curve: [{ t_ms: 0, lufs: -19 }], music_ranges: [] },
};

const sampleApplyResult: unknown = {
  group_id: S.group1,
  version: S.version,
  applied_count: 2,
  rejected_count: 0,
  results: [
    { op_id: S.op1, status: "applied" },
    { op_id: S.op2, status: "applied", snap: { requested_ms: 6100, snapped_ms: 6000, snapped_to: "silence", distance_ms: 100 } },
  ],
  warnings: [],
};

const sampleJobAccepted = (id: string): unknown => ({
  job_id: id,
  status: { job_id: id, type: "render.preview", state: "queued", progress: 0, updated_ms: 1700000000000 },
});

/* ------------------------------------------------------------------ */
/* The 21 tools                                                        */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "create_project",
    title: "Create project",
    mutating: true,
    scopes: ["projects:write"],
    errors: ["VALIDATION_FAILED", "ASSET_NOT_FOUND", "QUOTA_EXCEEDED", "AUTH_REQUIRED", "SCOPE_FORBIDDEN"],
    input: CreateProjectRequest,
    output: z.object({ project: Project }).strict(),
    description:
      "Create a new editing project, optionally attached to an uploaded asset. " +
      "Use when the user wants to start editing a file that has already been uploaded, or before uploading. " +
      "Example 1: create an empty project titled 'Episode 12'. " +
      "Example 2: create a project directly from a completed upload session so ingest starts immediately.",
    examples: [
      {
        summary: "Empty project",
        input: { title: "Episode 12" },
        output: {
          project: {
            id: S.project_id,
            title: "Episode 12",
            status: "created",
            timeline_version: 1,
            created_ms: 1700000000000,
            updated_ms: 1700000000000,
          },
        },
      },
      {
        summary: "Project from an upload session",
        input: { title: "Coffee chat", source: { upload_session_id: S.ups1 } },
        output: {
          project: {
            id: S.project_id,
            title: "Coffee chat",
            status: "indexing",
            timeline_version: 1,
            created_ms: 1700000000000,
            updated_ms: 1700000000000,
          },
        },
      },
    ],
  },
  {
    name: "get_brief",
    title: "Get the Brief",
    mutating: false,
    scopes: ["projects:read"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "INDEX_NOT_READY", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: BriefQuery,
    output: Brief,
    description:
      "Read the project's Brief: segments with IDs, speakers, word timings, shots, audio markers, and editorial hints. " +
      "This is how you 'watch' the video — never request raw media. Start at detail 'summary' for long footage, then " +
      "use time_range or segment_ids to zoom in. Sections still indexing are flagged in `readiness`. " +
      "Example 1: summary of the whole project to plan an edit. " +
      "Example 2: standard detail for segments 11-12 only, including word timings.",
    examples: [
      {
        summary: "Whole project, summary detail",
        input: { project_id: S.project_id, detail: "summary" },
        output: sampleBrief,
      },
      {
        summary: "Two segments with words",
        input: { project_id: S.project_id, detail: "standard", segment_ids: [S.seg1, S.seg2] },
        output: sampleBrief,
      },
    ],
  },
  {
    name: "search_footage",
    title: "Search footage",
    mutating: false,
    scopes: ["projects:read"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "INDEX_NOT_READY", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        query: z.string().min(1).max(200).describe("Natural-language or keyword query."),
        mode: z.enum(["keyword", "semantic", "auto"]).default("auto").describe("auto falls back keyword->semantic."),
        limit: z.number().int().min(1).max(50).default(20),
        in_range: z
          .object({ from_ms: Ms, to_ms: Ms })
          .strict()
          .optional()
          .describe("Restrict hits to this timeline range."),
      })
      .strict(),
    output: z
      .object({
        mode_used: z.enum(["keyword", "semantic"]),
        hits: z
          .array(
            z
              .object({
                segment_ids: z.array(SegmentId).min(1),
                shot_ids: z.array(ShotId).optional(),
                score: z.number().min(0).max(1),
                snippet: z.string().max(300).describe("UNTRUSTED transcript excerpt around the hit."),
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
    description:
      "Search the project's transcript (and, when the embeddings index is ready, its meaning) and return ranked " +
      "segments with snippets. Use it to locate topics, moments, or quotes before planning operations. " +
      "Example 1: find where the guest talks about pricing. " +
      "Example 2: keyword search for 'beans' inside the first 10 minutes.",
    examples: [
      {
        summary: "Semantic search",
        input: { project_id: S.project_id, query: "where do we discuss pricing", mode: "semantic" },
        output: {
          mode_used: "semantic",
          hits: [{ segment_ids: [S.seg2], score: 0.91, snippet: "First, the beans matter more than the machine." }],
        },
      },
      {
        summary: "Keyword search in a range",
        input: { project_id: S.project_id, query: "beans", mode: "keyword", in_range: { from_ms: 0, to_ms: 600000 } },
        output: {
          mode_used: "keyword",
          hits: [{ segment_ids: [S.seg2], score: 1.0, snippet: "First, the beans matter more than the machine." }],
        },
      },
    ],
  },
  {
    name: "get_frames",
    title: "Get frames",
    mutating: false,
    scopes: ["media:read"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "INDEX_NOT_READY", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        segment_ids: z.array(SegmentId).min(1).max(16).optional().describe("Sample frames from these segments."),
        time_points_ms: z
          .array(Ms)
          .min(1)
          .max(16)
          .optional()
          .describe("Exact timeline times to sample (max 16 per call)."),
        max_frames: z.number().int().min(1).max(16).default(6),
        include_contact_sheet: z.boolean().default(false).describe("Also return a grid contact sheet."),
      })
      .strict()
      .refine((i) => i.segment_ids !== undefined || i.time_points_ms !== undefined, {
        message: "provide segment_ids or time_points_ms",
      }),
    output: z
      .object({
        frames: z
          .array(
            z.object({
              segment_id: SegmentId.optional(),
              t_ms: Ms,
              storage_key: z.string().max(512).describe("Fetch via a signed URL (media:read)."),
            }),
          )
          .max(16),
        contact_sheet: z
          .object({ storage_key: z.string().max(512), cols: z.number().int().min(1), rows: z.number().int().min(1) })
          .optional(),
      })
      .strict(),
    description:
      "Retrieve still frames for visual verification of segments or exact times. Frames come back as storage keys; " +
      "they are only delivered when explicitly requested (privacy rule). Use sparingly — most edits need the Brief alone. " +
      "Example 1: one frame at 3s to check the opening shot. " +
      "Example 2: a 4-frame contact sheet across a segment to verify a reframe.",
    examples: [
      {
        summary: "Frame at 3s",
        input: { project_id: S.project_id, time_points_ms: [3000] },
        output: { frames: [{ t_ms: 3000, storage_key: `projects/${S.project_id}/frames/3000.jpg` }] },
      },
      {
        summary: "Contact sheet for a segment",
        input: { project_id: S.project_id, segment_ids: [S.seg1], max_frames: 4, include_contact_sheet: true },
        output: {
          frames: [
            { segment_id: S.seg1, t_ms: 1000, storage_key: `projects/${S.project_id}/frames/1000.jpg` },
            { segment_id: S.seg1, t_ms: 2250, storage_key: `projects/${S.project_id}/frames/2250.jpg` },
            { segment_id: S.seg1, t_ms: 3500, storage_key: `projects/${S.project_id}/frames/3500.jpg` },
            { segment_id: S.seg1, t_ms: 4750, storage_key: `projects/${S.project_id}/frames/4750.jpg` },
          ],
          contact_sheet: { storage_key: `projects/${S.project_id}/sheets/${S.seg1}.jpg`, cols: 2, rows: 2 },
        },
      },
    ],
  },
  {
    name: "list_styles",
    title: "List edit styles",
    mutating: false,
    scopes: ["projects:read"],
    errors: ["VALIDATION_FAILED", "AUTH_REQUIRED"],
    input: z.object({}).strict().describe("No parameters."),
    output: StyleListResult,
    description:
      "List available edit style recipes and their tunable parameters. Pass a style slug to plan_edit or to " +
      "high-level tools like remove_fillers. " +
      "Example 1: list all styles before planning a podcast cleanup. " +
      "Example 2: list styles to find the short-form parameters for clip extraction.",
    examples: [
      {
        summary: "All styles",
        input: {},
        output: {
          styles: [
            {
              id: S.style_podcast,
              slug: "podcast-clean",
              name: "Podcast Clean",
              description: "Remove long pauses and fillers, level loudness to -16 LUFS.",
              params: [
                { key: "pause_threshold_ms", type: "number", default: 600, min: 200, max: 3000, description: "Pauses longer than this are removed." },
                { key: "captions", type: "boolean", default: false, description: "Burn captions into the export." },
              ],
            },
          ],
        },
      },
      {
        summary: "Check short-form parameters",
        input: {},
        output: {
          styles: [
            {
              id: S.style_podcast,
              slug: "podcast-clean",
              name: "Podcast Clean",
              description: "Remove long pauses and fillers, level loudness to -16 LUFS.",
              params: [
                { key: "pause_threshold_ms", type: "number", default: 600, min: 200, max: 3000, description: "Pauses longer than this are removed." },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    name: "plan_edit",
    title: "Plan an edit",
    mutating: false,
    scopes: ["projects:read"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "INDEX_NOT_READY", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        goal: z.string().min(1).max(1000).describe("What the user wants, in plain language."),
        style_id: StyleId.optional(),
        constraints: z
          .object({
            target_duration_ms: Ms.optional(),
            max_operations: z.number().int().min(1).max(500).optional(),
            aspect: Aspect.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    output: z
      .object({
        plan: z
          .object({
            steps: z.array(z.string().max(200)).max(20).describe("Server-side planning template steps for this goal+style."),
            suggested_operations: z
              .array(z.custom<Operation>(() => true))
              .max(100)
              .describe("Starting-point operations derived from Brief hints; adapt them, then apply_edits."),
            parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
          })
          .strict(),
        notes: z.string().max(300),
      })
      .strict(),
    description:
      "Fetch a server-side planning template (rules, constraints, targets) for a goal and style. The response " +
      "contains deterministic suggested operations computed from Brief hints — treat them as a starting point and " +
      "adapt before applying. " +
      "Example 1: plan a podcast cleanup. " +
      "Example 2: plan a 30s vertical clip from the intro.",
    examples: [
      {
        summary: "Podcast cleanup plan",
        input: { project_id: S.project_id, goal: "clean up pauses and fillers", style_id: S.style_podcast },
        output: {
          plan: {
            steps: [
              "Remove pauses > 600ms down to 250ms",
              "Remove fillers at sentence starts",
              "Normalize loudness to -16 LUFS",
            ],
            suggested_operations: [
              {
                id: S.op1,
                type: "ripple_delete",
                target: { clip_ids: [S.clip2] },
                params: {},
                rationale: "Pause 2.0s exceeds 0.6s cap",
              },
            ],
            parameters: { pause_threshold_ms: 600, target_lufs: -16 },
          },
          notes: "3 filler clusters and 4 long pauses detected.",
        },
      },
      {
        summary: "Vertical clip plan",
        input: {
          project_id: S.project_id,
          goal: "cut a 30s vertical clip from the intro",
          constraints: { target_duration_ms: 30000, aspect: "9:16" },
        },
        output: {
          plan: {
            steps: ["Pick hook within first 3s", "Reframe to 9:16 with tracking", "Add word-highlight captions"],
            suggested_operations: [],
            parameters: { aspect: "9:16", max_chars_per_line: 42 },
          },
          notes: "No strong hook detected in the first 60s; ask the user or pick the highest-energy moment.",
        },
      },
    ],
  },
  {
    name: "apply_edits",
    title: "Apply edits",
    mutating: true,
    scopes: ["projects:write"],
    errors: [
      "VALIDATION_FAILED",
      "OPERATION_INVALID",
      "TARGET_NOT_FOUND",
      "BATCH_TOO_LARGE",
      "VERSION_CONFLICT",
      "UNSNAPPABLE_TIME",
      "RATE_LIMITED",
      "SCOPE_FORBIDDEN",
      "AUTH_REQUIRED",
    ],
    input: OpBatch,
    output: ApplyEditsResult,
    description:
      "Apply a batch of operations atomically (all-or-nothing, max 500). Every operation needs a short `rationale`. " +
      "Reference existing clip/track IDs; raw times are snapped and each result reports the snap. The result lists " +
      "per-operation outcomes and the new timeline version — check rejected_count before declaring success. " +
      "Example 1: ripple-delete two clips that cover a long pause. " +
      "Example 2: split a clip at 6.1s (snapped to the silence at 6.0s) and set speed on the second part.",
    examples: [
      {
        summary: "Delete two filler clips",
        input: {
          project_id: S.project_id,
          base_version: 7,
          label: "Remove dead air in intro",
          operations: [
            { id: S.op1, type: "ripple_delete", target: { clip_ids: [S.clip2] }, params: {}, rationale: "1.9s pause exceeds 0.6s cap" },
            { id: S.op2, type: "ripple_delete", target: { clip_ids: [S.clip3] }, params: {}, rationale: "False start take" },
          ],
        },
        output: sampleApplyResult,
      },
      {
        summary: "Split then speed up",
        input: {
          project_id: S.project_id,
          base_version: 8,
          operations: [
            { id: S.op1, type: "split", target: { clip_id: S.clip1 }, params: { at_ms: 6100 }, rationale: "Cut before answer" },
            {
              id: S.op2,
              type: "set_speed",
              target: { clip_id: sampleId("clp", 52) },
              params: { speed: 1.5, preserves_pitch: true },
              rationale: "Tighten pacing of the answer",
            },
          ],
        },
        output: sampleApplyResult,
      },
    ],
  },
  {
    name: "remove_fillers",
    title: "Remove fillers",
    mutating: true,
    scopes: ["projects:write"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "INDEX_NOT_READY", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        aggressiveness: z
          .number()
          .min(0)
          .max(1)
          .default(0.7)
          .describe("0 = only clear fillers surrounded by pauses; 1 = also mid-sentence fillers."),
        filler_words: z.array(z.string().max(20)).max(50).optional().describe("Override the default filler list."),
        dry_run: z.boolean().default(true),
        ...AppliedExtra,
      })
      .strict()
      .refine((i) => !(i.dry_run && i.apply), { message: "dry_run and apply are mutually exclusive" }),
    output: z
      .object({
        proposed_operations: z.array(OperationSchema).max(500),
        filler_count: z.number().int().min(0),
        estimated_time_saved_ms: z.number().int().min(0),
        apply_result: ApplyEditsResult.optional(),
      })
      .strict(),
    description:
      "Transcript-aware filler word and silence removal with tunable aggressiveness. Returns ready-to-apply " +
      "operations; call with apply=true to execute them in the same atomic pipeline. " +
      "Example 1: preview what would be removed at default aggressiveness. " +
      "Example 2: aggressively remove fillers and apply immediately.",
    examples: [
      {
        summary: "Preview filler removal",
        input: { project_id: S.project_id, dry_run: true },
        output: {
          proposed_operations: [
            { id: S.op1, type: "ripple_delete", target: { clip_ids: [S.clip2] }, params: {}, rationale: "Filler 'um' + pause" },
          ],
          filler_count: 1,
          estimated_time_saved_ms: 900,
        },
      },
      {
        summary: "Aggressive removal, applied",
        input: { project_id: S.project_id, aggressiveness: 1, dry_run: false, apply: true },
        output: {
          proposed_operations: [
            { id: S.op1, type: "ripple_delete", target: { clip_ids: [S.clip2] }, params: {}, rationale: "Filler 'um'" },
            { id: S.op2, type: "ripple_delete", target: { clip_ids: [S.clip3] }, params: {}, rationale: "Filler 'uh'" },
          ],
          filler_count: 2,
          estimated_time_saved_ms: 1400,
          apply_result: sampleApplyResult,
        },
      },
    ],
  },
  {
    name: "extract_clips",
    title: "Extract clips",
    mutating: true,
    scopes: ["projects:write"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "INDEX_NOT_READY", "QUOTA_EXCEEDED", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        count: z.number().int().min(1).max(10).default(3),
        min_duration_ms: z.number().int().min(1000).max(300000).default(5000),
        max_duration_ms: z.number().int().min(1000).max(300000).default(60000),
        criteria: z.enum(["viral", "topic"]).default("viral"),
        topics: z.array(z.string().max(100)).max(10).optional().describe("When criteria=topic."),
        aspect: Aspect.optional().describe("e.g. '9:16' to also produce reframe operations."),
        apply: z.boolean().default(false),
      })
      .strict()
      .refine((i) => i.max_duration_ms > i.min_duration_ms, { message: "max_duration_ms must exceed min_duration_ms" }),
    output: z
      .object({
        clips: z
          .array(
            z
              .object({
                title: z.string().max(120),
                segment_ids: z.array(SegmentId).min(1),
                score: z.number().min(0).max(1),
                reasons: z.array(z.string().max(200)).max(5),
                proposed_operations: z.array(OperationSchema).max(200),
              })
              .strict(),
          )
          .max(10),
        apply_result: ApplyEditsResult.optional(),
      })
      .strict(),
    description:
      "Propose the N strongest standalone clips by topic or virality criteria, scored from Brief signals " +
      "(energy, hook words, completeness). With apply=true the chosen clips are added to new timelines as operations. " +
      "Example 1: propose 3 viral candidates for review. " +
      "Example 2: extract 2 vertical clips and apply.",
    examples: [
      {
        summary: "Propose 3 clips",
        input: { project_id: S.project_id, count: 3 },
        output: {
          clips: [
            {
              title: "Beans matter more than machines",
              segment_ids: [S.seg2],
              score: 0.87,
              reasons: ["Complete claim", "High energy"],
              proposed_operations: [],
            },
          ],
        },
      },
      {
        summary: "2 vertical clips applied",
        input: { project_id: S.project_id, count: 2, aspect: "9:16", apply: true },
        output: {
          clips: [
            {
              title: "Beans matter more than machines",
              segment_ids: [S.seg2],
              score: 0.87,
              reasons: ["Complete claim"],
              proposed_operations: [
                { id: S.op1, type: "reframe", target: { clip_id: S.clip1 }, params: { aspect: "9:16", mode: "track" }, rationale: "Vertical output" },
              ],
            },
          ],
          apply_result: sampleApplyResult,
        },
      },
    ],
  },
  {
    name: "add_captions",
    title: "Add captions",
    mutating: true,
    scopes: ["projects:write"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "INDEX_NOT_READY", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        style_id: StyleId.optional().describe("Caption style from list_styles."),
        template: z.enum(["line", "word_highlight"]).default("line"),
        language: LanguageCode.optional().describe("Defaults to the transcript language."),
        apply: z.boolean().default(false),
      })
      .strict(),
    output: z
      .object({
        proposed_operations: z.array(OperationSchema).max(500),
        caption_count: z.number().int().min(0),
        apply_result: ApplyEditsResult.optional(),
      })
      .strict(),
    description:
      "Generate caption cues from the transcript using a template, split to obey line-length and reading-speed " +
      "limits. Cue text comes from the transcript (untrusted content, delivered as data). " +
      "Example 1: preview line captions. " +
      "Example 2: apply word-highlight captions styled for short-form.",
    examples: [
      {
        summary: "Preview line captions",
        input: { project_id: S.project_id, template: "line" },
        output: {
          proposed_operations: [
            {
              id: S.op1,
              type: "add_caption",
              target: {},
              params: { start_ms: 1000, end_ms: 6000, text: "Welcome back to the show." },
              rationale: "Caption segment 1",
            },
          ],
          caption_count: 1,
        },
      },
      {
        summary: "Apply word-highlight captions",
        input: { project_id: S.project_id, template: "word_highlight", apply: true },
        output: {
          proposed_operations: [
            {
              id: S.op1,
              type: "add_caption",
              target: {},
              params: {
                start_ms: 1000,
                end_ms: 6000,
                text: "Welcome back to the show.",
                words: [{ w: "Welcome", s: 1000, e: 1400, c: 0.98 }],
              },
              rationale: "Word-highlight captions",
            },
          ],
          caption_count: 1,
          apply_result: sampleApplyResult,
        },
      },
    ],
  },
  {
    name: "reframe",
    title: "Reframe",
    mutating: true,
    scopes: ["projects:write"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        aspect: Aspect,
        mode: z.enum(["center", "fixed", "track"]).default("track"),
        apply: z.boolean().default(false),
      })
      .strict(),
    output: z
      .object({
        proposed_operations: z.array(OperationSchema).max(500),
        apply_result: ApplyEditsResult.optional(),
      })
      .strict(),
    description:
      "Produce reframe operations for the whole timeline to a target aspect. mode 'track' follows the detected " +
      "subject with smoothing; requires the visual index (check readiness). " +
      "Example 1: preview a 9:16 center reframe. " +
      "Example 2: apply tracked 9:16 reframing.",
    examples: [
      {
        summary: "Preview 9:16",
        input: { project_id: S.project_id, aspect: "9:16", mode: "center" },
        output: {
          proposed_operations: [
            { id: S.op1, type: "reframe", target: { clip_id: S.clip1 }, params: { aspect: "9:16", mode: "center" }, rationale: "Vertical output" },
          ],
        },
      },
      {
        summary: "Apply tracked 9:16",
        input: { project_id: S.project_id, aspect: "9:16", mode: "track", apply: true },
        output: {
          proposed_operations: [
            { id: S.op1, type: "reframe", target: { clip_id: S.clip1 }, params: { aspect: "9:16", mode: "track", smoothing_ms: 300 }, rationale: "Vertical output" },
          ],
          apply_result: sampleApplyResult,
        },
      },
    ],
  },
  {
    name: "audio_cleanup",
    title: "Audio cleanup",
    mutating: true,
    scopes: ["projects:write"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        target_lufs: z.number().min(-27).max(-9).default(-16),
        denoise: z.boolean().default(false),
        duck_music: z.boolean().default(false),
        apply: z.boolean().default(false),
      })
      .strict(),
    output: z
      .object({
        proposed_operations: z.array(OperationSchema).max(500),
        apply_result: ApplyEditsResult.optional(),
      })
      .strict(),
    description:
      "Propose loudness normalization, optional denoise, and optional music ducking under speech. " +
      "Example 1: preview normalization to -16 LUFS. " +
      "Example 2: apply -14 LUFS normalization with music ducking.",
    examples: [
      {
        summary: "Preview normalization",
        input: { project_id: S.project_id },
        output: {
          proposed_operations: [
            {
              id: S.op1,
              type: "normalize_audio",
              target: { whole_timeline: true },
              params: { target_lufs: -16, true_peak_dbtp: -1, mode: "two_pass" },
              rationale: "Meet -16 LUFS podcast target",
            },
          ],
        },
      },
      {
        summary: "Apply -14 LUFS + ducking",
        input: { project_id: S.project_id, target_lufs: -14, duck_music: true, apply: true },
        output: {
          proposed_operations: [
            {
              id: S.op1,
              type: "normalize_audio",
              target: { whole_timeline: true },
              params: { target_lufs: -14, true_peak_dbtp: -1, mode: "two_pass" },
              rationale: "Meet -14 LUFS target",
            },
            {
              id: S.op2,
              type: "duck_audio",
              target: { music_track_id: S.track_a1 },
              params: { under_track_id: S.track_v1, amount_db: -12, attack_ms: 20, release_ms: 300 },
              rationale: "Music under speech",
            },
          ],
          apply_result: sampleApplyResult,
        },
      },
    ],
  },
  {
    name: "find_broll",
    title: "Find B-roll",
    mutating: false,
    scopes: ["projects:read"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        query: z.string().min(1).max(200),
        count: z.number().int().min(1).max(10).default(3),
        library: z.enum(["user", "stock"]).default("user").describe("stock is P2 and requires a license agreement."),
      })
      .strict(),
    output: z
      .object({
        suggestions: z
          .array(
            z
              .object({
                asset_id: AssetId.optional().describe("Present for user-library hits."),
                source: z.string().max(120),
                description: z.string().max(300),
                license_note: z.string().max(200).optional(),
              })
              .strict(),
          )
          .max(10),
        note: z.string().max(300).optional(),
      })
      .strict(),
    description:
      "Suggest B-roll from the user's library matching a description. Suggestions are read-only: to use one, issue " +
      "an insert_broll operation with the returned asset_id. " +
      "Example 1: find coffee-pour B-roll in the user library. " +
      "Example 2: find city b-roll and learn nothing matched.",
    examples: [
      {
        summary: "Library hit",
        input: { project_id: S.project_id, query: "coffee being poured", count: 2 },
        output: {
          suggestions: [
            { asset_id: S.asset_id, source: "user library", description: "Slow-motion espresso pour, 4s" },
          ],
        },
      },
      {
        summary: "No match",
        input: { project_id: S.project_id, query: "aerial city timelapse" },
        output: { suggestions: [], note: "No user-library media matched; consider find_broll with library 'stock' (P2)." },
      },
    ],
  },
  {
    name: "translate",
    title: "Translate",
    mutating: true,
    scopes: ["projects:write"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "QUOTA_EXCEEDED", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        languages: z.array(LanguageCode).min(1).max(5),
        dub: z.boolean().default(false).describe("P2: generate dubbed audio tracks; metered."),
      })
      .strict(),
    output: z.object({ jobs: z.array(JobId).min(1).max(5), note: z.string().max(300).optional() }).strict(),
    description:
      "Queue caption translation (and optionally dubbing) for one or more languages. This is async: poll get_status " +
      "with the returned job IDs. " +
      "Example 1: translate captions to Spanish and German. " +
      "Example 2: request dubbing (may be refused at plan level in v1).",
    examples: [
      {
        summary: "Two caption languages",
        input: { project_id: S.project_id, languages: ["es", "de"] },
        output: { jobs: [S.job1, S.job2], note: "Caption translation queued for es, de." },
      },
      {
        summary: "Dub requested",
        input: { project_id: S.project_id, languages: ["fr"], dub: true },
        output: { jobs: [S.job1], note: "Dubbing is metered and P2; caption translation only in this release." },
      },
    ],
  },
  {
    name: "preview",
    title: "Render preview",
    mutating: true,
    scopes: ["render"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "RENDER_FAILED", "QUOTA_EXCEEDED", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        base_version: z.number().int().min(1).optional().describe("Defaults to the current timeline version."),
        range_ms: z.object({ start_ms: Ms, end_ms: Ms }).strict().optional(),
        max_width: z.number().int().min(160).max(1280).default(480),
      })
      .strict(),
    output: JobAccepted,
    description:
      "Start a low-resolution proxy render of the timeline (or a range) and return a job. Fetch the playable URL " +
      "via get_status once the job is running; first playable frame target is under 5 seconds (RND-3). " +
      "Example 1: preview the whole timeline at 480px. " +
      "Example 2: preview just the first 20 seconds.",
    examples: [
      {
        summary: "Full preview",
        input: { project_id: S.project_id },
        output: sampleJobAccepted(S.job1),
      },
      {
        summary: "Range preview",
        input: { project_id: S.project_id, range_ms: { start_ms: 0, end_ms: 20000 }, max_width: 320 },
        output: sampleJobAccepted(S.job2),
      },
    ],
  },
  {
    name: "verify",
    title: "Verify quality",
    mutating: false,
    scopes: ["projects:read"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: VerifyRequest,
    output: VerifyReport,
    description:
      "Run deterministic quality checks (mid-word cuts, clicks, loudness, captions, sync, black frames) and return " +
      "structured findings with suggested fixes. Run after applying operations and again before render. " +
      "Example 1: verify everything after a cleanup pass. " +
      "Example 2: verify only caption readability with tighter limits.",
    examples: [
      {
        summary: "All checks",
        input: { project_id: S.project_id },
        output: {
          run_id: S.run1,
          project_id: S.project_id,
          version: S.version,
          passed: true,
          findings: [],
          stats: { duration_ms: 1500, checks_run: ["MID_WORD_CUT", "LOUDNESS_OFF_TARGET", "CAPTION_READABILITY"] },
        },
      },
      {
        summary: "Caption check only",
        input: { project_id: S.project_id, checks: ["CAPTION_READABILITY"], thresholds: { caption_max_cps: 15 } },
        output: {
          run_id: S.run1,
          project_id: S.project_id,
          version: S.version,
          passed: false,
          findings: [
            {
              code: "CAPTION_READABILITY",
              severity: "warning",
              location: { caption_ids: [S.cap1] },
              message: "Reading speed 19 cps exceeds 15 cps.",
              suggested_fix: "Split the caption at the sentence boundary or extend end_ms to 6600.",
            },
          ],
          stats: { duration_ms: 300, checks_run: ["CAPTION_READABILITY"] },
        },
      },
    ],
  },
  {
    name: "undo",
    title: "Undo a change",
    mutating: true,
    scopes: ["projects:write"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({ project_id: ProjectId, group_id: z.string().optional().describe("Defaults to the latest group.") })
      .strict(),
    output: UndoResult,
    description:
      "Revert one operation group (an atomic batch). Use when the user rejects a change or a verify pass shows the " +
      "edit was wrong. Groups are shown in get_status. " +
      "Example 1: undo the last batch. " +
      "Example 2: undo a specific group by ID.",
    examples: [
      {
        summary: "Undo last",
        input: { project_id: S.project_id },
        output: { undone_group_id: S.group1, version: { version: 6, hash: "b".repeat(64) }, can_undo: true, can_redo: true },
      },
      {
        summary: "Undo specific group",
        input: { project_id: S.project_id, group_id: S.group1 },
        output: { undone_group_id: S.group1, version: { version: 5, hash: "c".repeat(64) }, can_undo: false, can_redo: true },
      },
    ],
  },
  {
    name: "redo",
    title: "Redo a change",
    mutating: true,
    scopes: ["projects:write"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({ project_id: ProjectId, group_id: z.string().optional().describe("Defaults to the most recently undone group.") })
      .strict(),
    output: RedoResult,
    description:
      "Re-apply the most recently undone operation group. " +
      "Example 1: redo after an accidental undo. " +
      "Example 2: redo a specific group.",
    examples: [
      {
        summary: "Redo last undone",
        input: { project_id: S.project_id },
        output: { redone_group_id: S.group1, version: S.version, can_undo: true, can_redo: false },
      },
      {
        summary: "Redo specific group",
        input: { project_id: S.project_id, group_id: S.group1 },
        output: { redone_group_id: S.group1, version: S.version, can_undo: true, can_redo: false },
      },
    ],
  },
  {
    name: "render",
    title: "Render export",
    mutating: true,
    scopes: ["render"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "RENDER_FAILED", "QUOTA_EXCEEDED", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        preset: z
          .enum(["youtube_1080p", "youtube_4k", "shorts_1080x1920", "web_720p", "prores_master", "audio_only"])
          .default("youtube_1080p"),
        burn_captions: z.boolean().default(true),
      })
      .strict(),
    output: JobAccepted,
    description:
      "Start a full-quality export render with a preset. The output URL arrives via get_status job artifacts. " +
      "Verify should pass (or be consciously waived) first. " +
      "Example 1: render the YouTube 1080p preset with burned captions. " +
      "Example 2: render a vertical short without captions.",
    examples: [
      {
        summary: "YouTube 1080p",
        input: { project_id: S.project_id, preset: "youtube_1080p", burn_captions: true },
        output: sampleJobAccepted(S.job1),
      },
      {
        summary: "Vertical short, no captions",
        input: { project_id: S.project_id, preset: "shorts_1080x1920", burn_captions: false },
        output: sampleJobAccepted(S.job2),
      },
    ],
  },
  {
    name: "export_project",
    title: "Export project",
    mutating: true,
    scopes: ["export"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "EXPORT_FAILED", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId,
        format: z.enum(["otio", "fcpxml", "edl", "srt", "vtt"]),
        include_media: z.boolean().default(false).describe("Bundle media into an archive (large)."),
      })
      .strict(),
    output: JobAccepted,
    description:
      "Export the project as an interchange format: OpenTimelineIO, FCPXML, EDL, or captions as SRT/VTT. The " +
      "download key arrives via get_status job artifacts. " +
      "Example 1: export the timeline as OTIO for Premiere/Resolve. " +
      "Example 2: export captions as SRT.",
    examples: [
      {
        summary: "OTIO export",
        input: { project_id: S.project_id, format: "otio" },
        output: sampleJobAccepted(S.job1),
      },
      {
        summary: "SRT captions",
        input: { project_id: S.project_id, format: "srt" },
        output: sampleJobAccepted(S.job2),
      },
    ],
  },
  {
    name: "get_status",
    title: "Get status",
    mutating: false,
    scopes: ["projects:read"],
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "SCOPE_FORBIDDEN", "AUTH_REQUIRED"],
    input: z
      .object({
        project_id: ProjectId.optional(),
        job_id: z.string().optional().describe("Poll a single job."),
        include_readiness: z.boolean().default(true),
      })
      .strict()
      .refine((i) => i.project_id !== undefined || i.job_id !== undefined, {
        message: "provide project_id or job_id",
      }),
    output: z
      .object({
        jobs: z.array(JobStatus).max(50),
        readiness: BriefReadiness.optional(),
        timeline_version: TimelineVersionInfo.optional(),
      })
      .strict(),
    description:
      "Check job progress and index readiness. Use it to wait for analysis sections before reading the Brief, to " +
      "poll render/preview jobs, and to learn the current timeline version before apply_edits. " +
      "Example 1: wait for transcript readiness. " +
      "Example 2: poll a render job.",
    examples: [
      {
        summary: "Project readiness",
        input: { project_id: S.project_id },
        output: {
          jobs: [],
          readiness: { transcript: "ready", speakers: "ready", shots: "pending", audio: "ready", visual: "pending" },
          timeline_version: S.version,
        },
      },
      {
        summary: "Poll render job",
        input: { job_id: S.job1, include_readiness: false },
        output: {
          jobs: [
            {
              job_id: S.job1,
              type: "render.export",
              state: "running",
              progress: 62,
              stage: "encoding chunk 3/5",
              updated_ms: 1700000000000,
            },
          ],
        },
      },
    ],
  },
];

/** Integrity checks used by tests and the MCP artifact generator. */
export function validateToolRegistry(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of TOOL_DEFS) {
    if (seen.has(t.name)) problems.push(`duplicate tool name: ${t.name}`);
    seen.add(t.name);
    if (!t.description.includes("Example 1")) problems.push(`${t.name}: description lacks 'Example 1'`);
    if (!t.description.includes("Example 2")) problems.push(`${t.name}: description lacks 'Example 2'`);
    if (t.examples.length < 2) problems.push(`${t.name}: needs >= 2 examples`);
    if (t.mutating && t.scopes.length === 0) problems.push(`${t.name}: mutating tool needs scopes`);
    if (t.mutating && !t.scopes.some((s) => s !== "projects:read")) {
      problems.push(`${t.name}: mutating tool needs a write-capable scope`);
    }
    for (const code of t.errors) {
      if (!ERROR_CODES_SET.has(code)) problems.push(`${t.name}: unknown error code ${code}`);
    }
  }
  for (const name of TOOL_NAMES) {
    if (!seen.has(name)) problems.push(`missing tool: ${name}`);
  }
  return problems;
}

/** Tool names not in the canonical list. */
export const UNUSED_OP_TYPES_NOTE =
  "Operation types available to tools: " + OPERATION_TYPES.join(", ");

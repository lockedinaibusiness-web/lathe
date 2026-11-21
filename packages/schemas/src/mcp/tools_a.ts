/**
 * MCP tool definitions, part A: discovery and planning tools.
 * Concatenated by mcp/tools.ts into the full registry.
 */

import { z } from "zod";
import { defineTool, type McpToolDef } from "./registry.js";
import { Summary } from "../common.js";
import { ProjectId, StyleId, JobId } from "../ids.js";
import { GetBriefRequest, GetBriefResponse } from "../brief.js";
import { GetFramesRequest, GetFramesResponse } from "../brief.js";
import { SearchFootageRequest, SearchFootageResponse } from "../brief.js";
import { ListStylesResponse, PlanEditRequest, PlanEditResponse } from "../styles.js";

const projectIdIn = z.object({
  project_id: ProjectId.describe("Project ID returned by create_project"),
});

export const createProjectTool: McpToolDef = defineTool({
  name: "create_project",
  title: "Create project",
  description:
    "Create a project from a completed upload or a source URL and start indexing (proxy generation, transcript, diarization, shots, audio features). Returns immediately with status 'indexing'; poll get_status until the Brief is ready. A project is the scope for every other tool.",
  annotations: { readOnlyHint: false, idempotentHint: true },
  scopes: ["project:edit"],
  errors: ["AUTH_REQUIRED", "UPLOAD_INCOMPLETE", "MEDIA_UNSUPPORTED", "RATE_LIMITED"],
  examples: [
    {
      title: "Create from a finished upload",
      input: {
        name: "Podcast ep 12",
        upload_id: "upl_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        language: "en",
        idempotency_key: "create-ep12-0001",
      },
      output_summary: "Project prj_... created (status: indexing). Transcript + audio index expected in ~25 s.",
    },
    {
      title: "Create from a URL with a style preselected",
      input: {
        name: "Tutorial 03",
        source_url: "https://storage.example.com/tutorial-03.mp4",
        style_id: "sty_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        idempotency_key: "create-tut03-0001",
      },
      output_summary: "Project prj_... created and importing from URL; indexing starts once bytes arrive.",
    },
  ],
  input: z.object({
    name: z.string().min(1).max(200),
    upload_id: z.string().regex(/^upl_[A-Za-z0-9]{10,64}$/).optional(),
    source_url: z.string().url().optional(),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
    style_id: StyleId.optional(),
    idempotency_key: z.string().min(8).max(128),
  }),
  output: z.object({
    project_id: ProjectId,
    status: z.enum(["draft", "indexing", "ready"]),
    summary: Summary,
  }),
});

export const getBriefTool: McpToolDef = defineTool({
  name: "get_brief",
  title: "Get the Brief",
  description:
    "Return the Brief: the compact text description of the footage you edit against (segments with word timings, speakers, shots, silences, loudness, editorial hints). Use detail 'summary' first (under 8k tokens for a 60-minute video), then zoom with 'range' for the sections you want to cut. Never ask for raw video: request frames with get_frames instead. Readiness flags tell you what is still indexing.",
  annotations: { readOnlyHint: true },
  scopes: ["project:read"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "RANGE_INVALID", "SCOPE_DENIED", "BRIEF_NOT_READY"],
  examples: [
    {
      title: "Standard Brief for the whole project",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD", detail: "standard" },
      output_summary:
        "Brief for 42:10 of footage: 612 segments, 2 speakers, transcript ready; shots and visual pending (progress 0.6).",
    },
    {
      title: "Zoom into a time range at full detail with word timings",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        detail: "full",
        range: { kind: "time", start_s: 120, end_s: 300 },
      },
      output_summary: "18 segments between 02:00-05:00 with word-level timings and per-shot boundaries.",
    },
  ],
  input: GetBriefRequest,
  output: z.object({
    brief: GetBriefResponse.shape.brief,
    pending_sections: z.array(z.string()),
    summary: Summary,
  }),
});

export const searchFootageTool: McpToolDef = defineTool({
  name: "search_footage",
  title: "Search footage",
  description:
    "Search the transcript (and shot OCR when the visual index is ready) by keywords or meaning. Keyword mode is always available; semantic mode activates once embeddings finish. Use it to locate statements, topics, or on-screen text before cutting.",
  annotations: { readOnlyHint: true },
  scopes: ["project:read"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "SEARCH_INDEX_NOT_READY"],
  examples: [
    {
      title: "Keyword search for a topic",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD", query: "pricing experiment", mode: "keyword", limit: 5 },
      output_summary: "5 segment hits where 'pricing' and 'experiment' co-occur, top hit at 12:41 (score 0.91).",
    },
    {
      title: "Semantic search after embeddings are ready",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD", query: "why we left our last job", mode: "semantic" },
      output_summary: "3 segment hits about career history, none containing the query words verbatim.",
    },
  ],
  input: SearchFootageRequest,
  output: z.object({
    mode: z.enum(["keyword", "semantic"]),
    hits: SearchFootageResponse.shape.hits,
    notice: z.string().optional(),
    summary: Summary,
  }),
});

export const getFramesTool: McpToolDef = defineTool({
  name: "get_frames",
  title: "Get frames",
  description:
    "Retrieve still frames or a contact sheet for given segment IDs, shot IDs, or times. This is the ONLY way to look at the picture; use it to verify framing, faces, or on-screen text before reframing or cutting. URLs are signed and expire.",
  annotations: { readOnlyHint: true },
  scopes: ["project:read"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "RANGE_INVALID"],
  examples: [
    {
      title: "Three frames per shot for a contact sheet",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        shot_ids: ["sht_01J8ZQ4K2M9T3X7YB6N0PWABCD"],
        per_target: 3,
        contact_sheet: true,
      },
      output_summary: "Contact sheet URL + 3 frames at 24%, 52%, 81% through the shot.",
    },
    {
      title: "Frames for specific segments at small width",
      input: {
        project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD",
        segment_ids: ["seg_01J8ZQ4K2M9T3X7YB6N0PWABCD", "seg_01J8ZQ4K2M9T3X7YB6N0PWABCE"],
        width: 320,
      },
      output_summary: "6 frames (3 per segment) as signed URLs, 320px wide.",
    },
  ],
  input: GetFramesRequest,
  output: z.object({
    frames: GetFramesResponse.shape.frames,
    contact_sheet_url: z.string().url().optional(),
    summary: Summary,
  }),
});

export const listStylesTool: McpToolDef = defineTool({
  name: "list_styles",
  title: "List styles",
  description:
    "List the available edit style recipes (Podcast Clean, Talking Head Tight, Tutorial, Short-Form Clip, Highlight Reel) with all parameters and the caption presets they use. Styles are data recipes: pass a style_id to plan_edit to get deterministic rules you can follow.",
  annotations: { readOnlyHint: true },
  scopes: ["project:read"],
  errors: ["AUTH_REQUIRED"],
  examples: [
    {
      title: "List all styles with parameters",
      input: {},
      output_summary:
        "5 styles: podcast-clean (pauses >0.6s -> 0.25s, -16 LUFS), talking-head-tight (0.35s cap, 5-10% zooms, -14 LUFS), tutorial, short-form-clip, highlight-reel.",
    },
    {
      title: "Pick a style before planning",
      input: {},
      output_summary: "Use style_id sty_podcast_clean in plan_edit for a podcast cleanup job.",
    },
  ],
  input: z.object({}).strict(),
  output: z.object({
    styles: ListStylesResponse.shape.styles,
    caption_styles: ListStylesResponse.shape.caption_styles,
    summary: Summary,
  }),
});

export const planEditTool: McpToolDef = defineTool({
  name: "plan_edit",
  title: "Plan an edit",
  description:
    "Get a server-side planning template for a goal + style: the ordered steps (which tools to call with which parameters), constraints verify will enforce, and targets. Follow the plan and turn it into one apply_edits batch. This keeps edit quality consistent regardless of which model runs.",
  annotations: { readOnlyHint: true },
  scopes: ["project:read"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "STYLE_NOT_FOUND", "BRIEF_NOT_READY"],
  examples: [
    {
      title: "Podcast cleanup plan",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD", goal: "cleanup", style_id: "sty_01J8ZQ4K2M9T3X7YB6N0PWABC3" },
      output_summary:
        "4 steps: get_brief standard -> remove_fillers(aggressiveness 0.7) -> trim dead air >0.6s -> normalize_audio -16 LUFS; verify will require loudness within 1 LU.",
    },
    {
      title: "Short-form clip extraction plan",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD", goal: "short_form_clip", target_length_s: 45, clips: 3 },
      output_summary:
        "Steps: hook candidates -> extract_clips(3, 20-60s) -> add_captions(max 2 lines/42 chars) -> reframe 9:16 -> normalize -14 LUFS.",
    },
  ],
  input: PlanEditRequest,
  output: z.object({
    goal: z.string(),
    style: PlanEditResponse.shape.style,
    steps: PlanEditResponse.shape.steps,
    constraints: z.record(z.string(), z.unknown()),
    summary: Summary,
  }),
});

export const getStatusTool: McpToolDef = defineTool({
  name: "get_status",
  title: "Get status",
  description:
    "Check job progress and Brief readiness for a project. Use it after create_project and after starting renders: it reports each job's state, progress 0..1, current stage, and any error with a suggested fix.",
  annotations: { readOnlyHint: true },
  scopes: ["project:read"],
  errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "JOB_NOT_FOUND"],
  examples: [
    {
      title: "Poll while indexing",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD" },
      output_summary:
        "proxy.generate done; analysis.transcribe done (100%); analysis.shots active 62%; transcript and audio ready, shots pending.",
    },
    {
      title: "Poll a specific render job",
      input: { project_id: "prj_01J8ZQ4K2M9T3X7YB6N0PWABCD", job_id: "job_01J8ZQ4K2M9T3X7YB6N0PWABCD" },
      output_summary: "render.full active at 41%, stage 'encoding chunk 2/4'.",
    },
  ],
  input: projectIdIn.extend({
    job_id: JobId.optional(),
  }),
  output: z.object({
    jobs: z.array(
      z.object({
        job_id: JobId,
        type: z.string(),
        state: z.enum(["queued", "active", "completed", "failed", "cancelled", "waiting"]),
        progress: z.number().min(0).max(1),
        stage: z.string().optional(),
        error: z
          .object({ code: z.string(), message: z.string(), suggested_fix: z.string().optional() })
          .optional(),
      }),
    ),
    summary: Summary,
  }),
});
/**
 * HTTP API contract (PLG-2).
 *
 * Routes are declared once here; `pnpm gen` turns them into the OpenAPI
 * document (docs/generated/openapi.json) via the Zod schemas they reference.
 * The Fastify app (M6) registers handlers against this same list, so the spec
 * and the server can never drift.
 */

import { z } from "zod";
import { ProjectId, JobId, ApiKeyId } from "./ids.js";
import { Project, ProjectList, CreateProjectRequest } from "./projects.js";
import {
  ApplyEditsRequest,
  ApplyEditsResponse,
  UndoRedoRequest,
  UndoRedoResponse,
} from "./operations.js";
import { GetBriefRequest, GetBriefResponse, GetFramesRequest, GetFramesResponse } from "./brief.js";
import { SearchFootageRequest, SearchFootageResponse } from "./brief.js";
import { VerifyRequest, VerifyResponse } from "./verify.js";
import { GetStatusResponse } from "./jobs.js";
import {
  PreviewRequest,
  PreviewResponse,
  RenderRequest,
  RenderResponse,
  ExportProjectRequest,
  ExportProjectResponse,
} from "./render.js";
import { ListStylesResponse } from "./styles.js";

/** Alias kept for route docs: projects use the shared Project contract. */
const ProjectSummary = Project;

const ListProjectsResponse = ProjectList;

const InitUploadRequest = z.object({
  filename: z.string().min(1).max(500),
  content_type: z.string().min(1).max(100),
  size_bytes: z.number().int().positive().max(50 * 1024 * 1024 * 1024),
  chunk_size_bytes: z.number().int().positive().optional(),
});
const InitUploadResponse = z.object({
  upload_id: z.string().regex(/^upl_[A-Za-z0-9]{10,64}$/),
  chunk_size_bytes: z.number().int().positive(),
  total_chunks: z.number().int().positive(),
  /** Signed per-chunk PUT targets (expire). */
  upload_urls: z.array(z.object({ chunk_index: z.number().int().nonnegative(), url: z.string().url() })),
});
const CompleteUploadRequest = z.object({
  parts: z.array(z.object({ chunk_index: z.number().int().nonnegative(), etag: z.string().min(1) })),
});
const CompleteUploadResponse = z.object({
  upload_id: z.string(),
  asset_id: z.string().regex(/^ast_[A-Za-z0-9]{10,64}$/),
  content_hash: z.string().min(8).max(128),
  duration_s: z.number().nonnegative().finite().optional(),
});

const ApiKeyCreateRequest = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(z.string().regex(/^(project:[a-z0-9-]+:(edit|read)|admin)$/)).min(1),
});
const ApiKeyCreateResponse = z.object({
  id: ApiKeyId,
  /** Returned exactly once; never logged, never recoverable. */
  key: z.string().min(20).max(200),
  name: z.string(),
  scopes: z.array(z.string()),
  created_at: z.string().datetime({ offset: true }),
});

export interface RouteContract {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  auth: "api_key" | "oauth2" | "none";
  /** OAuth scopes required (for the MCP/OAuth surface). */
  scopes?: string[];
  request?: {
    body?: z.ZodTypeAny;
    params?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
  };
  response: z.ZodTypeAny;
  /** Error codes this endpoint can return (from the shared catalog). */
  errors: string[];
}

const projectParams = z.object({ id: ProjectId });

export const ROUTES: RouteContract[] = [
  {
    method: "POST",
    path: "/v1/projects",
    operationId: "createProject",
    summary: "Create a project from a completed upload or a source URL",
    description:
      "Creates a project and starts indexing (proxy + analysis jobs). Returns immediately with status=indexing; poll GET /v1/projects/{id} or GET /v1/jobs/{id}.",
    tags: ["projects"],
    auth: "api_key",
    request: { body: CreateProjectRequest },
    response: ProjectSummary,
    errors: ["AUTH_REQUIRED", "UPLOAD_INCOMPLETE", "MEDIA_UNSUPPORTED", "RATE_LIMITED"],
  },
  {
    method: "GET",
    path: "/v1/projects",
    operationId: "listProjects",
    summary: "List projects for the account",
    description: "Cursor-paginated list of projects, newest first.",
    tags: ["projects"],
    auth: "api_key",
    request: {
      query: z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) }),
    },
    response: ListProjectsResponse,
    errors: ["AUTH_REQUIRED"],
  },
  {
    method: "GET",
    path: "/v1/projects/{id}",
    operationId: "getProject",
    summary: "Get a project summary including timeline version",
    description: "Returns project status and current timeline version (for optimistic concurrency).",
    tags: ["projects"],
    auth: "api_key",
    request: { params: projectParams },
    response: ProjectSummary,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "SCOPE_DENIED"],
  },
  {
    method: "POST",
    path: "/v1/uploads",
    operationId: "initUpload",
    summary: "Initialize a chunked, resumable upload",
    description:
      "Returns chunk size and signed per-chunk upload URLs. Analysis can start on first chunks; the project is created after complete.",
    tags: ["uploads"],
    auth: "api_key",
    request: { body: InitUploadRequest },
    response: InitUploadResponse,
    errors: ["AUTH_REQUIRED", "UPLOAD_TOO_LARGE", "RATE_LIMITED"],
  },
  {
    method: "PUT",
    path: "/v1/uploads/{id}/chunks/{index}",
    operationId: "uploadChunk",
    summary: "Upload one chunk (resumable: retry any chunk by index)",
    description: "Raw bytes to the signed chunk URL. Retrying a chunk overwrites it; uploads are resumable by design.",
    tags: ["uploads"],
    auth: "api_key",
    request: {
      params: z.object({ id: z.string().regex(/^upl_[A-Za-z0-9]{10,64}$/), index: z.number().int().nonnegative() }),
    },
    response: z.object({ received: z.boolean(), chunk_index: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() }),
    errors: ["AUTH_REQUIRED", "UPLOAD_INCOMPLETE"],
  },
  {
    method: "POST",
    path: "/v1/uploads/{id}/complete",
    operationId: "completeUpload",
    summary: "Finish an upload and assemble the asset",
    description: "Server assembles chunks, verifies the hash, and makes the asset ready for project creation.",
    tags: ["uploads"],
    auth: "api_key",
    request: {
      params: z.object({ id: z.string().regex(/^upl_[A-Za-z0-9]{10,64}$/) }),
      body: CompleteUploadRequest,
    },
    response: CompleteUploadResponse,
    errors: ["AUTH_REQUIRED", "UPLOAD_INCOMPLETE", "MEDIA_UNSUPPORTED"],
  },
  {
    method: "GET",
    path: "/v1/projects/{id}/brief",
    operationId: "getBrief",
    summary: "Get the Brief (detail level + optional range)",
    description:
      "The Brief is queryable while indexing runs; readiness flags show what is pending. Detail levels: summary (<8k tokens for 60 min), standard, full.",
    tags: ["brief"],
    auth: "api_key",
    request: { params: projectParams, query: GetBriefRequest.omit({ project_id: true }) },
    response: GetBriefResponse,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "RANGE_INVALID", "SCOPE_DENIED"],
  },
  {
    method: "GET",
    path: "/v1/projects/{id}/frames",
    operationId: "getFrames",
    summary: "Get frames or a contact sheet for segments/shots/times",
    description: "Returns signed, expiring frame URLs (never logged).",
    tags: ["brief"],
    auth: "api_key",
    request: { params: projectParams, query: GetFramesRequest.omit({ project_id: true }) },
    response: GetFramesResponse,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "RANGE_INVALID"],
  },
  {
    method: "POST",
    path: "/v1/projects/{id}/edits/apply",
    operationId: "applyEdits",
    summary: "Apply a batch of up to 500 operations atomically",
    description:
      "All-or-nothing. Per-operation results include snap reports for raw timecodes. Requires base_version for optimistic concurrency and an idempotency key for safe retries.",
    tags: ["edits"],
    auth: "api_key",
    request: { params: projectParams, body: ApplyEditsRequest.omit({ project_id: true }) },
    response: ApplyEditsResponse,
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
  },
  {
    method: "POST",
    path: "/v1/projects/{id}/edits/undo",
    operationId: "undoEdits",
    summary: "Undo an operation group or batch",
    description: "Reverts to the pre-batch timeline state. Grouped and labeled in history.",
    tags: ["edits"],
    auth: "api_key",
    request: { params: projectParams, body: UndoRedoRequest.omit({ project_id: true }) },
    response: UndoRedoResponse,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "VERSION_CONFLICT", "IDEMPOTENCY_REUSED"],
  },
  {
    method: "POST",
    path: "/v1/projects/{id}/edits/redo",
    operationId: "redoEdits",
    summary: "Redo a previously undone group",
    description: "Re-applies an undone operation group.",
    tags: ["edits"],
    auth: "api_key",
    request: { params: projectParams, body: UndoRedoRequest.omit({ project_id: true }) },
    response: UndoRedoResponse,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "VERSION_CONFLICT", "IDEMPOTENCY_REUSED"],
  },
  {
    method: "POST",
    path: "/v1/projects/{id}/search",
    operationId: "searchFootage",
    summary: "Keyword and semantic search over transcript and shots",
    description: "Keyword search is always available; semantic search activates when the embedding index is ready.",
    tags: ["brief"],
    auth: "api_key",
    request: { params: projectParams, body: SearchFootageRequest.omit({ project_id: true }) },
    response: SearchFootageResponse,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "SEARCH_INDEX_NOT_READY"],
  },
  {
    method: "GET",
    path: "/v1/styles",
    operationId: "listStyles",
    summary: "List edit style recipes and caption presets",
    description: "Styles are data recipes with parameters; the model reads them via plan_edit or this endpoint.",
    tags: ["styles"],
    auth: "api_key",
    response: ListStylesResponse,
    errors: ["AUTH_REQUIRED"],
  },
  {
    method: "POST",
    path: "/v1/projects/{id}/preview",
    operationId: "preview",
    summary: "Render a low-res proxy preview of a range",
    description: "Proxy-based; first playable result in seconds. Never blocks the full-quality pipeline.",
    tags: ["render"],
    auth: "api_key",
    request: { params: projectParams, body: PreviewRequest.omit({ project_id: true }) },
    response: PreviewResponse,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "JOB_FAILED"],
  },
  {
    method: "POST",
    path: "/v1/projects/{id}/render",
    operationId: "render",
    summary: "Start a full-quality render",
    description:
      "Smart render is the default (stream-copy unchanged GOPs, re-encode boundaries/effects) with automatic full-re-encode fallback. Results are cached by content hash.",
    tags: ["render"],
    auth: "api_key",
    request: { params: projectParams, body: RenderRequest.omit({ project_id: true }) },
    response: RenderResponse,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "RENDER_FAILED", "RATE_LIMITED"],
  },
  {
    method: "POST",
    path: "/v1/projects/{id}/verify",
    operationId: "verify",
    summary: "Run automated quality checks",
    description:
      "Deterministic checks: mid-word cuts, clicks, clipping, loudness, caption overflow/reading speed, black frames, A/V drift, level jumps. Findings carry suggested_fix.",
    tags: ["verify"],
    auth: "api_key",
    request: { params: projectParams, body: VerifyRequest.omit({ project_id: true }) },
    response: VerifyResponse,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "JOB_FAILED"],
  },
  {
    method: "POST",
    path: "/v1/projects/{id}/export",
    operationId: "exportProject",
    summary: "Export OTIO/FCPXML/EDL or captions (SRT/VTT)",
    description: "Returns a signed download URL for the exported file.",
    tags: ["export"],
    auth: "api_key",
    request: { params: projectParams, body: ExportProjectRequest.omit({ project_id: true }) },
    response: ExportProjectResponse,
    errors: ["AUTH_REQUIRED", "PROJECT_NOT_FOUND", "RATE_LIMITED"],
  },
  {
    method: "GET",
    path: "/v1/jobs/{id}",
    operationId: "getJob",
    summary: "Get job status and progress",
    description: "Poll for analysis/preview/render progress. Also mirrored in project readiness.",
    tags: ["jobs"],
    auth: "api_key",
    request: { params: z.object({ id: JobId }) },
    response: GetStatusResponse,
    errors: ["AUTH_REQUIRED", "JOB_NOT_FOUND"],
  },
  {
    method: "POST",
    path: "/v1/auth/api-keys",
    operationId: "createApiKey",
    summary: "Create an API key (shown once)",
    description: "Keys are stored hashed, shown exactly once at creation, and never logged. Scopes are per-project.",
    tags: ["auth"],
    auth: "api_key",
    request: { body: ApiKeyCreateRequest },
    response: ApiKeyCreateResponse,
    errors: ["AUTH_REQUIRED", "SCOPE_DENIED"],
  },
];
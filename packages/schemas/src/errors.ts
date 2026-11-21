/**
 * Shared error-code catalog (PLG-5).
 *
 * Every error returned by any surface (MCP tool, HTTP API, worker message)
 * uses a code from this catalog. Each code carries a `suggested_fix` the
 * calling model or client can act on without human interpretation.
 */

export const ErrorCodes = {
  // --- Scope / auth ---
  AUTH_REQUIRED: {
    http_status: 401,
    message: "Missing or malformed credentials.",
    suggested_fix: "Send a valid API key or OAuth 2.1 access token for this account and project.",
  },
  AUTH_INVALID: {
    http_status: 401,
    message: "Credentials were rejected.",
    suggested_fix: "Re-authenticate; API keys are shown only once at creation. Mint a new key if needed.",
  },
  SCOPE_DENIED: {
    http_status: 403,
    message: "The credentials do not grant access to this project.",
    suggested_fix: "Use a token whose scope includes project:<id>:edit (or read for read-only tools).",
  },
  RATE_LIMITED: {
    http_status: 429,
    message: "Too many requests for the current quota.",
    suggested_fix: "Back off exponentially and retry after the Retry-After interval; batch operations instead of spamming single calls.",
  },

  // --- Request validation ---
  VALIDATION_FAILED: {
    http_status: 400,
    message: "The request payload failed contract validation.",
    suggested_fix: "Compare against the published schema (docs/generated); fix field names, types, and required fields.",
  },
  NOT_FOUND: {
    http_status: 404,
    message: "The requested resource or route does not exist.",
    suggested_fix: "Check the ID and path against a list call (e.g. GET /v1/projects) before retrying.",
  },
  INTERNAL: {
    http_status: 500,
    message: "Unexpected server error.",
    suggested_fix: "Retry once; if it persists, report the request ID with the failing route.",
  },

  // --- Project / asset ---
  PROJECT_NOT_FOUND: {
    http_status: 404,
    message: "No project with that ID exists for this account.",
    suggested_fix: "Call list_projects (or GET /v1/projects) and use an ID from the response.",
  },
  PROJECT_LOCKED: {
    http_status: 409,
    message: "The project is locked by another operation in flight.",
    suggested_fix: "Poll get_status until the active job finishes, then retry this call.",
  },
  ASSET_NOT_FOUND: {
    http_status: 404,
    message: "The referenced asset does not exist.",
    suggested_fix: "List the project's assets and pick one from the response; do not invent asset IDs.",
  },
  MEDIA_UNSUPPORTED: {
    http_status: 415,
    message: "The uploaded container or codec is not supported.",
    suggested_fix: "Use MP4/MOV/MKV/WebM with H.264, HEVC, ProRes, or AV1; re-mux with FFmpeg if needed.",
  },

  // --- Upload / ingest ---
  UPLOAD_INCOMPLETE: {
    http_status: 409,
    message: "The upload has not received all chunks.",
    suggested_fix: "Finish the chunk sequence (or resume it), then call the complete endpoint before creating the project.",
  },
  UPLOAD_TOO_LARGE: {
    http_status: 413,
    message: "The file exceeds the 50 GB per-file limit.",
    suggested_fix: "Split the source into parts and re-assemble, or transcode to a smaller file first.",
  },

  // --- Brief / analysis readiness ---
  BRIEF_NOT_READY: {
    http_status: 409,
    message: "The requested Brief section is still being indexed.",
    suggested_fix: "Read readiness in the current Brief; poll get_status or retry after analysis completes. Summary-level data is usually available earlier.",
  },
  SEARCH_INDEX_NOT_READY: {
    http_status: 409,
    message: "The embedding index for this project is still building.",
    suggested_fix: "Use keyword search now (mode: keyword) and retry semantic search after get_status reports embeddings ready.",
  },

  // --- Operations ---
  OP_TARGET_NOT_FOUND: {
    http_status: 422,
    message: "An operation references a clip, segment, track, or caption that does not exist.",
    suggested_fix: "Re-read the Brief (or the latest apply response) and use IDs exactly as returned; IDs are stable across sessions.",
  },
  OP_INVALID_TIME: {
    http_status: 422,
    message: "A time reference is unparseable or outside the source duration.",
    suggested_fix: "Use kind: word/clip/frame references from the Brief, or seconds within 0..duration_s.",
  },
  OP_SNAP_AMBIGUOUS: {
    http_status: 422,
    message: "The requested cut could not be placed within the snap tolerance without landing mid-word.",
    suggested_fix: "Widen default_snap_tolerance_ms (up to a few hundred ms) or reference a word boundary directly with kind: word.",
  },
  OP_INVALID_PARAMS: {
    http_status: 422,
    message: "Operation parameters failed semantic validation.",
    suggested_fix: "Check ranges (speed 0.1–8, gain −60..+24 dB, transition 0–5 s) and remove contradictory flags; see the operation schema docs.",
  },
  OP_CONFLICT: {
    http_status: 409,
    message: "Operations in the batch conflict with each other or with existing effects.",
    suggested_fix: "Re-order or remove the conflicting operations (e.g. two transitions on the same clip edge) and resubmit the batch.",
  },
  BATCH_TOO_LARGE: {
    http_status: 422,
    message: "The batch exceeds 500 operations.",
    suggested_fix: "Split into multiple apply_edits calls of at most 500 operations each.",
  },
  VERSION_CONFLICT: {
    http_status: 409,
    message: "base_version does not match the project's current timeline version.",
    suggested_fix: "Re-read the latest timeline version, rebase your plan on it, and resubmit with the new base_version.",
  },
  IDEMPOTENCY_REUSED: {
    http_status: 409,
    message: "This idempotency key was already used with a different payload.",
    suggested_fix: "Use a fresh idempotency key for a new batch; reuse the same key only for retries of the identical batch.",
  },

  // --- Jobs / render ---
  JOB_NOT_FOUND: {
    http_status: 404,
    message: "No job with that ID exists.",
    suggested_fix: "Use the job ID returned by the call that started the job, or get_status for the project.",
  },
  JOB_FAILED: {
    http_status: 500,
    message: "The worker job failed.",
    suggested_fix: "Read error.details, fix the reported cause (e.g. unsupported codec), then retry the job once; report persistent failures with the job ID.",
  },
  RENDER_FAILED: {
    http_status: 500,
    message: "The render pipeline failed and no output was produced.",
    suggested_fix: "Run verify to find timeline defects (black frames, missing sources), fix findings, then retry render.",
  },

  // --- Styles / captions ---
  STYLE_NOT_FOUND: {
    http_status: 404,
    message: "The style or caption preset ID does not exist.",
    suggested_fix: "Call list_styles to get current style and caption-preset IDs with their parameters.",
  },
  CAPTION_NOT_FOUND: {
    http_status: 404,
    message: "The caption ID does not exist on this project.",
    suggested_fix: "List captions from the timeline view (get_brief full, or the review UI) and retry with an existing ID.",
  },

  // --- Search ---
  RANGE_INVALID: {
    http_status: 422,
    message: "The requested range is empty or outside the source duration.",
    suggested_fix: "Clamp ranges to 0..duration_s and ensure start_s < end_s.",
  },
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

/** Machine-safe check that a string is a known error code. */
export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ErrorCodes, v);
}

/** Full catalog entry for a code (http_status + messages). Throws on unknown. */
export function errorDef(code: ErrorCode): { http_status: number; message: string; suggested_fix: string } {
  const entry = ErrorCodes[code] as { http_status: number; message: string; suggested_fix: string } | undefined;
  if (!entry) throw new Error(`Unknown error code: ${code}`);
  return entry;
}
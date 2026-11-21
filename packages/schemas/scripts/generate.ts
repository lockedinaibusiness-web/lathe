/**
 * Contract generator: Zod schemas -> JSON Schema + OpenAPI + MCP tool manifest.
 *
 * Output locations:
 *   packages/schemas/generated/json-schema/*.schema.json   (committed)
 *   docs/generated/openapi.json                             (committed)
 *   docs/generated/mcp-tools.json                           (committed)
 *   docs/generated/contracts.json                           (index: name, version, sha256)
 *
 * Run: `pnpm gen` (writes) or `pnpm gen:check` (fails on drift).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  Operation,
  ApplyEditsRequest,
  ApplyEditsResponse,
  UndoRedoRequest,
  UndoRedoResponse,
  Brief,
  GetBriefRequest,
  GetBriefResponse,
  GetFramesRequest,
  GetFramesResponse,
  SearchFootageRequest,
  SearchFootageResponse,
  Finding,
  VerifyRequest,
  VerifyResponse,
  VerifyFixLoopRequest,
  VerifyFixLoopResponse,
  JobEnvelope,
  JobResultMessage,
  TranscriptResult,
  DiarizationResult,
  ShotsResult,
  AudioFeaturesResult,
  JobStatus,
  GetStatusResponse,
  RenderPreset,
  RenderRequest,
  RenderResponse,
  PreviewRequest,
  PreviewResponse,
  ExportProjectRequest,
  ExportProjectResponse,
  StyleRecipe,
  PlanEditRequest,
  PlanEditResponse,
  ListStylesResponse,
  CONTRACTS_VERSION,
  SCHEMA_BUNDLE_ID,
  Project,
  ProjectList,
  CreateProjectRequest,
  HealthResponse,
  ReadyzResponse,
  ROUTES,
  TOOLS,
  renderToolDescription,
  ErrorCodes,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, "..");
const REPO_ROOT = join(PKG_ROOT, "../..");
const JSON_SCHEMA_DIR = join(PKG_ROOT, "generated/json-schema");
const DOCS_GEN_DIR = join(REPO_ROOT, "docs/generated");
const CHECK = process.argv.includes("--check");

/** Single contract version stamped into every artifact (jobs.ts must match). */
const CONTRACT_VERSION = CONTRACTS_VERSION;

interface Contract {
  file: string;
  title: string;
  description: string;
  schema: z.ZodTypeAny;
}

const CONTRACTS: Contract[] = [
  { file: "operation.schema.json", title: "Operation", description: "One invertible timeline operation (discriminated union).", schema: Operation },
  { file: "apply-edits-request.schema.json", title: "ApplyEditsRequest", description: "Atomic batch apply request (max 500 ops).", schema: ApplyEditsRequest },
  { file: "apply-edits-response.schema.json", title: "ApplyEditsResponse", description: "Per-operation results, snap reports, conflicts.", schema: ApplyEditsResponse },
  { file: "undo-redo-request.schema.json", title: "UndoRedoRequest", description: "Undo/redo request (group, batch, or last N).", schema: UndoRedoRequest },
  { file: "undo-redo-response.schema.json", title: "UndoRedoResponse", description: "Undo/redo result with new timeline version.", schema: UndoRedoResponse },
  { file: "brief.schema.json", title: "Brief", description: "The compact model-readable project description.", schema: Brief },
  { file: "get-brief-request.schema.json", title: "GetBriefRequest", description: "Brief request with detail level and range.", schema: GetBriefRequest },
  { file: "get-brief-response.schema.json", title: "GetBriefResponse", description: "Brief response with pending sections.", schema: GetBriefResponse },
  { file: "get-frames-request.schema.json", title: "GetFramesRequest", description: "Frame/contact-sheet request.", schema: GetFramesRequest },
  { file: "get-frames-response.schema.json", title: "GetFramesResponse", description: "Signed frame URLs response.", schema: GetFramesResponse },
  { file: "search-footage-request.schema.json", title: "SearchFootageRequest", description: "Keyword/semantic search request.", schema: SearchFootageRequest },
  { file: "search-footage-response.schema.json", title: "SearchFootageResponse", description: "Search hits response.", schema: SearchFootageResponse },
  { file: "finding.schema.json", title: "Finding", description: "One verification finding with location and fix.", schema: Finding },
  { file: "verify-request.schema.json", title: "VerifyRequest", description: "Verification request.", schema: VerifyRequest },
  { file: "verify-response.schema.json", title: "VerifyResponse", description: "Verification result with findings and metrics.", schema: VerifyResponse },
  { file: "verify-fix-loop.schema.json", title: "VerifyFixLoopRequest", description: "Auto-fix loop envelope (max 3 passes).", schema: VerifyFixLoopRequest },
  { file: "job-envelope.schema.json", title: "JobEnvelope", description: "Versioned job message to workers (TS <-> Python).", schema: JobEnvelope },
  { file: "job-result.schema.json", title: "JobResultMessage", description: "Worker completion message.", schema: JobResultMessage },
  { file: "job-status.schema.json", title: "JobStatus", description: "Public job status view.", schema: JobStatus },
  { file: "transcript-result.schema.json", title: "TranscriptResult", description: "Word-level transcript result.", schema: TranscriptResult },
  { file: "diarization-result.schema.json", title: "DiarizationResult", description: "Speaker turns result (with fallback flag).", schema: DiarizationResult },
  { file: "shots-result.schema.json", title: "ShotsResult", description: "Shot boundaries result.", schema: ShotsResult },
  { file: "audio-features-result.schema.json", title: "AudioFeaturesResult", description: "Silences, loudness, music ranges, beats.", schema: AudioFeaturesResult },
  { file: "render-preset.schema.json", title: "RenderPreset", description: "Export preset shape.", schema: RenderPreset },
  { file: "render-request.schema.json", title: "RenderRequest", description: "Full-quality render request.", schema: RenderRequest },
  { file: "render-response.schema.json", title: "RenderResponse", description: "Render response with cache identity.", schema: RenderResponse },
  { file: "preview-request.schema.json", title: "PreviewRequest", description: "Proxy preview request.", schema: PreviewRequest },
  { file: "preview-response.schema.json", title: "PreviewResponse", description: "Proxy preview response.", schema: PreviewResponse },
  { file: "export-project-request.schema.json", title: "ExportProjectRequest", description: "OTIO/FCPXML/EDL/SRT/VTT export request.", schema: ExportProjectRequest },
  { file: "export-project-response.schema.json", title: "ExportProjectResponse", description: "Export response with signed URL.", schema: ExportProjectResponse },
  { file: "style-recipe.schema.json", title: "StyleRecipe", description: "Edit style recipe (data, not code).", schema: StyleRecipe },
  { file: "plan-edit-request.schema.json", title: "PlanEditRequest", description: "Planning template request.", schema: PlanEditRequest },
  { file: "plan-edit-response.schema.json", title: "PlanEditResponse", description: "Planning template: steps + constraints.", schema: PlanEditResponse },
  { file: "list-styles-response.schema.json", title: "ListStylesResponse", description: "Style + caption preset listing.", schema: ListStylesResponse },
  { file: "verify-fix-loop-response.schema.json", title: "VerifyFixLoopResponse", description: "Fix-loop result across passes.", schema: VerifyFixLoopResponse },
  { file: "get-status-response.schema.json", title: "GetStatusResponse", description: "Project job + readiness snapshot.", schema: GetStatusResponse },
  { file: "project.schema.json", title: "Project", description: "A project: workspace, timeline version, status.", schema: Project },
  { file: "project-list.schema.json", title: "ProjectList", description: "Paginated project list.", schema: ProjectList },
  { file: "create-project-request.schema.json", title: "CreateProjectRequest", description: "Create-project request.", schema: CreateProjectRequest },
  { file: "health-response.schema.json", title: "HealthResponse", description: "Health payload with contract version.", schema: HealthResponse },
  { file: "readyz-response.schema.json", title: "ReadyzResponse", description: "Readiness payload (database/storage/queue).", schema: ReadyzResponse },
];

function jsonSchemaFor(contract: Contract): Record<string, unknown> {
  const json = z.toJSONSchema(contract.schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://lathe.dev/schemas/${contract.file.replace(".schema.json", "")}`,
    title: contract.title,
    description: contract.description,
    "x-lathe-contract-version": CONTRACT_VERSION,
    ...json,
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function writeOrCheck(path: string, content: string, label: string): void {
  if (CHECK) {
    if (!existsSync(path)) {
      console.error(`DRIFT: ${label} is missing (${path})`);
      process.exitCode = 1;
      return;
    }
    const existing = readFileSync(path, "utf8");
    if (existing !== content) {
      console.error(`DRIFT: ${label} differs from generated output (${path})`);
      process.exitCode = 1;
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log(`wrote ${path.replace(REPO_ROOT, ".")}`);
}

function generateJsonSchemas(): void {
  const index: Array<{ file: string; title: string; sha256: string; version: string }> = [];
  const definitions: Record<string, unknown> = {};
  for (const contract of CONTRACTS) {
    const json = jsonSchemaFor(contract);
    const text = `${JSON.stringify(json, null, 2)}\n`;
    writeOrCheck(join(JSON_SCHEMA_DIR, contract.file), text, contract.title);
    index.push({ file: contract.file, title: contract.title, sha256: sha256(text), version: CONTRACT_VERSION });
    definitions[contract.title] = json;
  }
  // Bundled single-document schema (definitions keyed by contract title).
  // The API registers this with Fastify for response serialization.
  const bundle = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_BUNDLE_ID,
    title: "Lathe contracts bundle",
    "x-lathe-contract-version": CONTRACTS_VERSION,
    definitions,
  };
  writeOrCheck(
    join(PKG_ROOT, "generated/lathe.contracts.schema.json"),
    `${JSON.stringify(bundle, null, 2)}\n`,
    "contracts bundle",
  );
  writeOrCheck(
    join(JSON_SCHEMA_DIR, "index.json"),
    `${JSON.stringify({ contracts: index, version: CONTRACT_VERSION }, null, 2)}\n`,
    "json-schema index",
  );
  writeOrCheck(
    join(REPO_ROOT, "docs/schemas/INDEX.md"),
    renderSchemaIndex(index),
    "schema index docs",
  );
}

function renderSchemaIndex(index: Array<{ file: string; title: string; sha256: string }>): string {
  const lines = [
    "# Lathe contract schemas",
    "",
    `Generated from packages/schemas Zod definitions (contract version ${CONTRACTS_VERSION}).`,
    "Do not edit by hand; run `pnpm gen`. Full machine-readable forms:",
    "- JSON Schema: `packages/schemas/generated/json-schema/*.schema.json`",
    "- Bundled definitions: `packages/schemas/generated/lathe.contracts.schema.json`",
    "- OpenAPI: `docs/generated/openapi.json`",
    "- MCP tool manifest: `docs/generated/mcp-tools.json`",
    "",
    "| Contract | File | SHA-256 (16) |",
    "| --- | --- | --- |",
    ...index.map((c) => `| ${c.title} | ${c.file} | ${c.sha256} |`),
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// OpenAPI 3.1
// ---------------------------------------------------------------------------

function openApi(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const route of ROUTES) {
    const operation: Record<string, unknown> = {
      operationId: route.operationId,
      summary: route.summary,
      description: route.description,
      tags: route.tags,
      security: route.auth === "none" ? [] : [{ [route.auth === "api_key" ? "apiKey" : "oauth2"]: route.scopes ?? [] }],
    };
    if (route.request?.params) {
      operation.parameters = Object.entries(z.toJSONSchema(route.request.params, { target: "draft-2020-12" }).properties ?? {}).map(
        ([name, schema]) => ({
          name,
          in: "path",
          required: true,
          schema,
        }),
      );
    }
    if (route.request?.query) {
      const q = z.toJSONSchema(route.request.query, { target: "draft-2020-12" });
      operation.parameters = [
        ...((operation.parameters as unknown[]) ?? []),
        ...Object.entries(q.properties ?? {}).map(([name, schema]) => ({
          name,
          in: "query",
          required: (q.required as string[] | undefined)?.includes(name) ?? false,
          schema,
        })),
      ];
    }
    if (route.request?.body) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": { schema: z.toJSONSchema(route.request.body, { target: "draft-2020-12" }) },
        },
      };
    }
    const okSchema = z.toJSONSchema(route.response, { target: "draft-2020-12" });
    const responses: Record<string, unknown> = {
      "200": {
        description: route.summary,
        content: { "application/json": { schema: okSchema } },
      },
    };
    for (const code of new Set(route.errors)) {
      responses[String(_httpStatus(code))] = {
        description: code,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["error"],
              properties: {
                error: {
                  type: "object",
                  required: ["code", "message", "suggested_fix"],
                  properties: {
                    code: { type: "string", const: code },
                    message: { type: "string" },
                    suggested_fix: { type: "string" },
                  },
                },
              },
            },
          },
        },
      };
    }
    operation.responses = responses;
    paths[route.path] = { ...((paths[route.path] as object) ?? {}), [route.method.toLowerCase()]: operation };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Lathe HTTP API",
      version: CONTRACT_VERSION,
      description:
        "Function-calling / OpenAPI fallback for non-MCP models. The model edits the project, not the pixels.",
    },
    servers: [{ url: "http://127.0.0.1:8080", description: "local dev" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "Authorization", description: "Bearer <api key>" },
        oauth2: {
          type: "oauth2",
          description: "OAuth 2.1 for the MCP endpoint; per-project scopes.",
          flows: { authorizationCode: { authorizationUrl: "/oauth/authorize", tokenUrl: "/oauth/token", scopes: {} } },
        },
      },
    },
    paths,
  };
}

function _httpStatus(code: string): number {
  const entry = ErrorCodes[code as keyof typeof ErrorCodes] as { http_status: number } | undefined;
  return entry?.http_status ?? 400;
}

// ---------------------------------------------------------------------------
// MCP tool manifest
// ---------------------------------------------------------------------------

function mcpManifest(): Record<string, unknown> {
  return {
    server: {
      name: "lathe",
      version: CONTRACT_VERSION,
      description:
        "Autopilot video editing. Read the Brief, issue operations, render. Untrusted transcript/footage text is always inside delimited data blocks.",
    },
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: renderToolDescription(tool),
      annotations: tool.annotations,
      scopes: tool.scopes,
      inputSchema: z.toJSONSchema(tool.input, { target: "draft-2020-12" }),
      outputSchema: z.toJSONSchema(tool.output, { target: "draft-2020-12" }),
      errors: tool.errors,
      examples: tool.examples,
    })),
  };
}

// ---------------------------------------------------------------------------

function main(): void {
  generateJsonSchemas();
  writeOrCheck(join(DOCS_GEN_DIR, "openapi.json"), `${JSON.stringify(openApi(), null, 2)}\n`, "OpenAPI document");
  writeOrCheck(join(DOCS_GEN_DIR, "mcp-tools.json"), `${JSON.stringify(mcpManifest(), null, 2)}\n`, "MCP tool manifest");
  if (CHECK) {
    if (process.exitCode) {
      console.error("gen:check FAILED - generated artifacts are out of date. Run `pnpm gen`.");
    } else {
      console.log("gen:check OK - all generated artifacts match the schemas.");
    }
  } else {
    console.log("generate: done");
  }
}

main();
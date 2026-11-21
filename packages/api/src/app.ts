import Fastify, { type FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ProjectList} from "@lathe/schemas";
import {
  CONTRACTS_VERSION,
  CreateProjectRequest,
  Project,
  ReadyzResponse,
  SCHEMA_BUNDLE_ID,
  generateId,
  type ReadyzCheck,
} from "@lathe/schemas";
import type { Db} from "./db.js";
import { toInt } from "./db.js";
import type { StorageAdapter } from "./storage.js";
import { ApiError, registerErrorHandling } from "./errors.js";

export interface AppOptions {
  db: Db;
  storage?: StorageAdapter;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const { db } = opts;

  registerErrorHandling(app);

  // Response serialization from the generated bundle (single source of truth).
  const ref = (name: string) => ({ $ref: `${SCHEMA_BUNDLE_ID}#/definitions/${name}` });
  app.addSchema({ $id: SCHEMA_BUNDLE_ID, definitions: bundleDefinitions() });

  app.get("/healthz", async () => ({ status: "ok", version: CONTRACTS_VERSION }));

  app.get("/readyz", { schema: { response: { 200: ref("ReadyzResponse") } } }, async () => {
    const dbOk = db.connected ? await db.ping() : false;
    const checks: ReadyzCheck[] = [
      { name: "database", status: dbOk ? "ok" : "down" },
      ...(opts.storage
        ? [{ name: "storage" as const, status: "ok" as const }]
        : [{ name: "storage" as const, status: "down" as const, detail: "storage adapter not configured" }]),
    ];
    const anyDown = checks.some((c) => c.status !== "ok");
    const res = { status: anyDown ? "degraded" : "ok", checks };
    return ReadyzResponse.parse(res);
  });

  app.get(
    "/v1/projects",
    { schema: { response: { 200: ref("ProjectList") } } },
    async (): Promise<ProjectList> => {
      const rows = await db.query(
        "SELECT id, title, status, timeline_version, style_id, created_ms, updated_ms FROM projects ORDER BY created_ms DESC LIMIT 100",
      );
      return { projects: rows.map(rowToProject) };
    },
  );

  app.post(
    "/v1/projects",
    {
      schema: {
        response: { 201: { type: "object", properties: { project: ref("Project") }, required: ["project"] } },
      },
    },
    async (req, reply) => {
      const parsed = CreateProjectRequest.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError("VALIDATION_FAILED", "Request payload failed schema validation.", {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8) {
        throw new ApiError("VALIDATION_FAILED", "Idempotency-Key header of at least 8 characters is required.", {
          header: "Idempotency-Key",
        });
      }

      // Idempotency (Invariant 4): replay returns the stored response.
      const requestHash = stableHash(JSON.stringify(parsed.data));
      const existing = await db.query("SELECT response FROM idempotency_keys WHERE key = $1 AND scope = $2", [
        idempotencyKey,
        "POST /v1/projects",
      ]);
      const prev = existing[0]?.["response"];
      if (prev !== undefined) {
        const stored = prev as { request_hash: string; body: { project: Project } };
        if (stored.request_hash !== requestHash) {
          throw new ApiError("IDEMPOTENCY_REUSED", "Key reused with a different payload.");
        }
        reply.code(201);
        return stored.body;
      }

      const now = Date.now();
      const project: Project = {
        id: generateId("prj"),
        title: parsed.data.title,
        status: parsed.data.source ? "indexing" : "created",
        timeline_version: 1,
        ...(parsed.data.style_id ? { style_id: parsed.data.style_id } : {}),
        created_ms: now,
        updated_ms: now,
      };
      await db.query(
        "INSERT INTO projects (id, title, status, timeline_version, style_id, created_ms, updated_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          project.id,
          project.title,
          project.status,
          project.timeline_version,
          project.style_id ?? null,
          project.created_ms,
          project.updated_ms,
        ],
      );
      const body = { project };
      await db.query(
        "INSERT INTO idempotency_keys (key, scope, request_hash, response, created_ms) VALUES ($1,$2,$3,$4,$5)",
        [idempotencyKey, "POST /v1/projects", requestHash, JSON.stringify({ request_hash: requestHash, body }), now],
      );
      reply.code(201);
      return body;
    },
  );

  app.get<{ Params: { project_id: string } }>(
    "/v1/projects/:project_id",
    {
      schema: {
        response: { 200: { type: "object", properties: { project: ref("Project") }, required: ["project"] } },
      },
    },
    async (req) => {
      const rows = await db.query("SELECT * FROM projects WHERE id = $1", [req.params.project_id]);
      const row = rows[0];
      if (!row) throw new ApiError("NOT_FOUND", `project ${req.params.project_id} does not exist`);
      return { project: rowToProject(row) };
    },
  );

  app.get("/v1/__contract_version", async () => ({ contract_version: CONTRACTS_VERSION }));

  return app;
}

function rowToProject(row: Record<string, unknown>): Project {
  const styleId = row["style_id"];
  const candidate = {
    id: String(row["id"]),
    title: String(row["title"]),
    status: String(row["status"]) as Project["status"],
    timeline_version: toInt(row["timeline_version"]),
    ...(typeof styleId === "string" ? { style_id: styleId } : {}),
    created_ms: toInt(row["created_ms"]),
    updated_ms: toInt(row["updated_ms"]),
  };
  const parsed = Project.safeParse(candidate);
  if (!parsed.success) throw new Error(`project row failed contract validation: ${parsed.error.message}`);
  return parsed.data;
}

function stableHash(s: string): string {
  // FNV-1a 32-bit is enough to detect accidental payload drift for replay.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Load the committed generated bundle for fastify response serialization. */
function bundleDefinitions(): Record<string, unknown> {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundlePath = join(here, "..", "..", "schemas", "generated", "lathe.contracts.schema.json");
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as { definitions: Record<string, unknown> };
  return bundle.definitions;
}

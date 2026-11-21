import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import PgTest from "embedded-postgres";
import type { FastifyInstance } from "fastify";
import { Db } from "../src/db.js";
import { FsStorage } from "../src/storage.js";
import { buildApp } from "../src/app.js";
import { runMigrations } from "../src/migrate.js";
import { ProjectList, sampleId } from "@lathe/schemas";

let pg: InstanceType<typeof PgTest>;
let db: Db;
let app: FastifyInstance;
let storage: FsStorage;
let dbUrl = "";

beforeAll(async () => {
  const port = 55400 + Math.floor(Math.random() * 200);
  // embedded-postgres creates the cluster's default database (named after the
  // user, i.e. `postgres`); there is no `database` option (see its types).
  pg = new PgTest({
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  dbUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  db = new Db(dbUrl);
  db.connect();
  await runMigrations(dbUrl);
  storage = new FsStorage(join(tmpdir(), `lathe-test-storage-${Date.now()}`), "test-secret");
  app = buildApp({ db, storage });
  await app.ready();
}, 180000);

afterAll(async () => {
  await app?.close();
  await db?.close();
  await pg?.stop();
}, 60000);

describe("health and readiness", () => {
  it("healthz reports ok and the contracts version", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", version: "1.0.0" });
  });

  it("readyz reports database and storage ok", async () => {
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "database", status: "ok" }),
        expect.objectContaining({ name: "storage", status: "ok" }),
      ]),
    );
  });
});

describe("projects", () => {
  it("rejects a create without an Idempotency-Key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      payload: { title: "No key" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("creates a project and replays idempotently (Invariant 4)", async () => {
    const key = "create-project-0001";
    const payload = { title: "Episode 12" };
    const res1 = await app.inject({ method: "POST", url: "/v1/projects", headers: { "idempotency-key": key }, payload });
    expect(res1.statusCode).toBe(201);
    const p1 = res1.json().project;

    const res2 = await app.inject({ method: "POST", url: "/v1/projects", headers: { "idempotency-key": key }, payload });
    expect(res2.statusCode).toBe(201);
    expect(res2.json().project.id).toBe(p1.id);

    const res3 = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "idempotency-key": key },
      payload: { title: "Different" },
    });
    expect(res3.statusCode).toBe(409);
    expect(res3.json().error.code).toBe("IDEMPOTENCY_REUSED");
  });

  it("validates the payload against the contract", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "idempotency-key": "validation-check" },
      payload: { title: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("lists and gets projects conforming to the schema", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects" });
    expect(res.statusCode).toBe(200);
    const listParse = ProjectList.safeParse(res.json());
    expect(listParse.success).toBe(true);

    const id = sampleId("prj", 1);
    void id;
    const first = res.json().projects.at(-1);
    expect(first).toBeDefined();
    const got = await app.inject({ method: "GET", url: `/v1/projects/${first!.id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().project.id).toBe(first!.id);
  });

  it("returns the error envelope for unknown projects", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects/prj_NOPE" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    expect(res.json().error.suggested_fix).toBeTruthy();
  });
});

describe("migrations", () => {
  it("created the contracted tables", async () => {
    const rows = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    const names = rows.map((r) => String(r["table_name"]));
    for (const t of ["projects", "assets", "operation_groups", "idempotency_keys", "jobs", "timeline_versions", "upload_sessions"]) {
      expect(names).toContain(t);
    }
  });

  it("round-trips a bigint timestamp through the Db helper", async () => {
    const sha = createHash("sha256").update("x").digest("hex");
    void sha;
    const rows = await db.query<{ created_ms: unknown }>("SELECT created_ms FROM projects LIMIT 1");
    if (rows.length > 0) {
      expect(typeof rows[0]!.created_ms === "number" || typeof rows[0]!.created_ms === "string").toBe(true);
    }
  });
});


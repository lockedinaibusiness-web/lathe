#!/usr/bin/env node
/**
 * `pnpm dev` — bring up the local Lathe stack on one command (ADR-0001):
 *   1. embedded Postgres (user-space binaries, no admin, no Docker)
 *   2. database migrations
 *   3. the API server (packages/api)
 * Storage uses the FS adapter with signed URLs; Redis/MinIO arrive with the
 * workers via infra/docker-compose.yml (M2+).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, "..");
const servicesDir = join(repo, ".services");
const pgData = join(servicesDir, "pg");
const port = Number(process.env.LATHE_PG_PORT ?? 54333);
const signingSecret = process.env.LATHE_SIGNING_SECRET ?? "dev-only-signing-secret-change-me";
const apiPort = Number(process.env.LATHE_PORT ?? 8787);

function checkFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error("[dev] WARNING: ffmpeg not found on PATH; fixtures and render will not work.");
    return;
  }
  console.log(`[dev] ffmpeg: ${r.stdout.split("\n")[0]}`);
}

async function startPostgres() {
  const { default: Postgres } = await import("embedded-postgres");
  const { rmSync: rm } = await import("node:fs");
  const versionFile = join(pgData, "PG_VERSION");
  if (existsSync(pgData) && !existsSync(versionFile)) {
    // Half-written cluster from a killed run: drop it and start clean.
    console.warn(`[dev] incomplete postgres data dir (no PG_VERSION); recreating`);
    rm(pgData, { recursive: true, force: true });
  }
  if (!existsSync(pgData)) mkdirSync(pgData, { recursive: true });
  // embedded-postgres creates the cluster's default database (named after the
  // user, i.e. `postgres`); there is no `database` option in its options type.
  const pg = new Postgres({
    databaseDir: pgData,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });
  if (!existsSync(versionFile)) {
    await pg.initialise();
    console.log(`[dev] postgres cluster initialised at ${pgData}`);
  }
  await pg.start();
  console.log(`[dev] postgres ready on 127.0.0.1:${port} (db=postgres)`);
  return pg;
}

async function main() {
  checkFfmpeg();
  const pg = await startPostgres();
  const dbUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

  console.log("[dev] running migrations...");
  const mig = spawnSync(
    process.execPath,
    ["--import", "tsx", join(root, "db-migrate.ts")],
    { cwd: repo, encoding: "utf8", env: { ...process.env, DATABASE_URL: dbUrl } },
  );
  if (mig.status !== 0) {
    console.error(mig.stdout, mig.stderr);
    await pg.stop();
    process.exit(1);
  }
  process.stdout.write(mig.stdout);

  console.log("[dev] starting api...");
  const api = spawn(process.execPath, ["--import", "tsx", join(repo, "packages", "api", "src", "server.ts")], {
    cwd: repo,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      LATHE_PORT: String(apiPort),
      LATHE_SIGNING_SECRET: signingSecret,
      LATHE_STORAGE_DIR: join(repo, ".data", "storage"),
    },
    stdio: "inherit",
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\n[dev] shutting down...");
    api.kill();
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  api.on("exit", (code) => {
    if (!stopping) {
      console.error(`[dev] api exited with code ${code}; stopping postgres`);
      pg.stop().then(() => process.exit(code ?? 1));
    }
  });

  console.log(`[dev] stack up: api http://127.0.0.1:${apiPort}/healthz | postgres 127.0.0.1:${port}/lathe`);
  console.log("[dev] press Ctrl+C to stop");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

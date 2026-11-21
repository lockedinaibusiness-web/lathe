import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// node-pg-migrate is CommonJS exporting an object whose `default` is the
// migration runner (verified against the installed 7.9.1 build).
const nodePgMigrate = require("node-pg-migrate") as {
  default: (options: Record<string, unknown>) => Promise<unknown>;
};
const migrate = nodePgMigrate.default;

const here = dirname(fileURLToPath(import.meta.url));

/** Run all pending migrations against a database URL. */
export async function runMigrations(databaseUrl: string, log = (_msg: string) => {}): Promise<void> {
  await migrate({
    databaseUrl,
    dir: join(here, "..", "migrations"),
    migrationsTable: "pgmigrations",
    direction: "up",
    log: log,
  });
}

import { loadEnv, validateEnv } from "./env.js";
import { Db } from "./db.js";
import { FsStorage } from "./storage.js";
import { buildApp } from "./app.js";
import { runMigrations } from "./migrate.js";

const env = loadEnv();
const problems = validateEnv(env);
if (problems.length > 0) {
  console.error("invalid environment:\n  " + problems.join("\n  "));
  process.exit(1);
}

if (!env.databaseUrl) {
  console.error("DATABASE_URL is not set. Use `pnpm dev` (starts embedded Postgres) or set it explicitly.");
  process.exit(1);
}

const db = new Db(env.databaseUrl);
db.connect();
await runMigrations(env.databaseUrl, (m) => console.log(`[migrate] ${m}`));

const storage = new FsStorage(env.storageDir, env.signingSecret);
const app = buildApp({ db, storage });

await app.listen({ port: env.port, host: env.host });
console.log(`lathe api listening on http://${env.host}:${env.port}`);

async function shutdown() {
  await app.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

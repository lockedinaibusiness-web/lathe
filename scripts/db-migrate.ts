/** Apply database migrations to DATABASE_URL. */
import { runMigrations } from "@lathe/api";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Use `pnpm dev` (starts embedded Postgres) or set DATABASE_URL.");
  process.exit(1);
}

try {
  await runMigrations(url, (msg) => console.log(`[migrate] ${msg}`));
  console.log("[migrate] up to date");
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exit(1);
}

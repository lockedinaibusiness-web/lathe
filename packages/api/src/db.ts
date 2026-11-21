import { Pool } from "pg";

/** Thin Postgres handle. bigint columns come back as strings; helpers cast. */
export class Db {
  private pool: Pool | null = null;
  constructor(private readonly databaseUrl: string | undefined) {}

  get connected(): boolean {
    return this.pool !== null;
  }

  connect(databaseUrl?: string): void {
    const url = databaseUrl ?? this.databaseUrl;
    if (!url) throw new Error("DATABASE_URL is not configured");
    this.pool = new Pool({ connectionString: url, max: 10 });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) throw new Error("database not connected");
    const res = await this.pool.query(sql, params as never[]);
    return res.rows as T[];
  }

  async ping(): Promise<boolean> {
    try {
      await this.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

/** node-pg-migrate returns bigint counts as strings; cast safely. */
export function toInt(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  throw new Error(`not an integer: ${String(v)}`);
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";

/**
 * FS-backed object storage for local dev (ADR-0001). Implements the small
 * surface the platform needs: put, get, stat, and HMAC-signed expiring URLs.
 * The production adapter (MinIO/S3) implements the same interface from M2.
 * Signed URLs are never logged (security rule 9).
 */
export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  sign(key: string, method: "GET", ttlS: number, nowMs?: number): Promise<{ url: string; expires_ms: number }>;
  verify(key: string, method: "GET", expMs: number, sig: string, nowMs?: number): boolean;
}

export class FsStorage implements StorageAdapter {
  constructor(
    private readonly rootDir: string,
    private readonly secret: string,
  ) {}

  private pathFor(key: string): string {
    const safe = normalize(key).replace(/^([.][.][/\\])+/, "");
    return join(this.rootDir, safe);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<Buffer> {
    const p = this.pathFor(key);
    const { readFile } = await import("node:fs/promises");
    return readFile(p);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async sign(key: string, method: "GET", ttlS: number, nowMs = Date.now()) {
    const expires_ms = nowMs + ttlS * 1000;
    const sig = this.signature(key, method, expires_ms);
    return { url: `/media/${encodeURI(key)}?exp=${expires_ms}&sig=${sig}`, expires_ms };
  }

  verify(key: string, method: "GET", expMs: number, sig: string, nowMs = Date.now()): boolean {
    if (!Number.isFinite(expMs) || expMs < nowMs) return false;
    const expected = this.signature(key, method, expMs);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private signature(key: string, method: string, expiresMs: number): string {
    return createHmac("sha256", this.secret).update(`${method}:${key}:${expiresMs}`).digest("hex");
  }
}

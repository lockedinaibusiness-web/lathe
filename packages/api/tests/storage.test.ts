import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsStorage } from "../src/storage.js";

describe("FsStorage signed URLs", () => {
  it("put/get/exists round-trip", async () => {
    const root = await mkdtemp(join(tmpdir(), "lathe-store-"));
    const s = new FsStorage(root, "secret");
    await s.put("projects/p1/assets/a1/source.mp4", Buffer.from("mediabytes"));
    expect(await s.exists("projects/p1/assets/a1/source.mp4")).toBe(true);
    expect((await s.get("projects/p1/assets/a1/source.mp4")).toString()).toBe("mediabytes");
    expect(await s.exists("projects/p1/assets/a1/nope.mp4")).toBe(false);
  });

  it("signs and verifies a URL within its lifetime", async () => {
    const root = await mkdtemp(join(tmpdir(), "lathe-store-"));
    const s = new FsStorage(root, "secret");
    const { url, expires_ms } = await s.sign("projects/p1/renders/out.mp4", "GET", 60, 1000000);
    expect(url).toContain("/media/projects/p1/renders/out.mp4");
    const sig = new URL(url, "http://x").searchParams.get("sig")!;
    const exp = Number(new URL(url, "http://x").searchParams.get("exp"));
    expect(exp).toBe(expires_ms);
    expect(s.verify("projects/p1/renders/out.mp4", "GET", exp, sig, 1000001)).toBe(true);
  });

  it("rejects expired signatures", async () => {
    const root = await mkdtemp(join(tmpdir(), "lathe-store-"));
    const s = new FsStorage(root, "secret");
    const { expires_ms } = await s.sign("k", "GET", 10, 1000000);
    void expires_ms;
    const { url } = await s.sign("k", "GET", 10, 1000000);
    const u = new URL(url, "http://x");
    expect(s.verify("k", "GET", Number(u.searchParams.get("exp")), u.searchParams.get("sig")!, 2000000)).toBe(false);
  });

  it("rejects tampered signatures", async () => {
    const root = await mkdtemp(join(tmpdir(), "lathe-store-"));
    const s = new FsStorage(root, "secret");
    const { url } = await s.sign("k", "GET", 60, 1000000);
    const u = new URL(url, "http://x");
    const bad = "0".repeat(u.searchParams.get("sig")!.length);
    expect(s.verify("k", "GET", Number(u.searchParams.get("exp")), bad, 1000001)).toBe(false);
  });

  it("keeps keys inside the storage root", async () => {
    const root = await mkdtemp(join(tmpdir(), "lathe-store-"));
    const s = new FsStorage(root, "secret");
    expect(await s.exists("../../etc/passwd")).toBe(false);
    await expect(s.get("../../etc/passwd")).rejects.toThrow();
  });
});

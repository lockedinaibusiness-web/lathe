# Milestone 0 report — Foundations and contracts

**Status: complete.** All acceptance criteria verified on the dev machine
(Windows 11, Node 24.17.0, Python 3.13.7, FFmpeg 9.0.2, no Docker) on
2026-11-21. Checkpoint: awaiting go-ahead before M1.

## What was built

1. **Monorepo scaffold** — pnpm workspace (11 projects), strict TypeScript,
   ESLint 9 flat config, Prettier, vitest workspace, GitHub Actions CI
   (ubuntu + windows: lint, typecheck, gen-check, fixtures, tests).
2. **Contracts (`packages/schemas`)** — the single source of truth (ADR-0003):
   - Operations: all 16 types as a discriminated union with common fields
     (`id`, `type`, `target`, `params`, `rationale`, `group_id`), a metadata
     registry (category/invertible/stream effects), TimeSpec + SnapPolicy
     (cuts snap to word/frame/silence; reports returned), `apply_edits`
     request/response (≤ 500 ops, atomic, per-op results, conflicts),
     undo/redo contracts.
   - Brief: full shape with per-section readiness, detail levels
     (summary/standard/full), range queries (segments/time/speakers/shots),
     word shape `{w, s, e, c}`, frames/contact sheets, search contracts.
   - Jobs: versioned envelope + payloads for 12 job types, worker result
     messages, transcript/diarization/shots/audio-features result schemas.
   - MCP tools: all 21, each with a 2+-worked-example description, strict
     input/output schemas, `summary` result field, error codes with
     `suggested_fix`, MCP annotations, scopes (ADR-0011).
   - HTTP API: route table for projects/uploads/brief/frames/edits/search/
     styles/preview/render/verify/export/jobs/api-keys.
   - Styles (recipe schema), render presets (5 launch presets), verification
     findings (12 checks incl. extension slot), error catalog (33 codes).
3. **Generation** — `pnpm gen` emits per-contract JSON Schema, a bundled
   definitions document (registered with Fastify), OpenAPI 3.1, the MCP tool
   manifest, and `docs/schemas/INDEX.md`; `pnpm schemas:check` is
   drift-proofed by `tests/generated.test.ts`.
4. **API skeleton** (`packages/api`) — Fastify app with health/readiness/
   contract-version, projects CRUD with idempotent replay (invariant #4),
   node-pg-migrate migration (projects, timeline_versions, assets,
   upload_sessions, operation_groups, idempotency_keys, jobs), FS storage
   adapter with HMAC-signed expiring URLs.
5. **Local stack without Docker** (ADR-0001) — `pnpm dev` starts embedded
   Postgres 17, runs migrations, boots the API. Verified live: `/healthz`,
   `/readyz` (database+storage ok), project create → idempotent replay →
   get-by-id over real HTTP.
6. **Fixtures** — `fixtures/generate.mjs`: frame-numbered pattern, tone with
   planted silences, scene cuts at known timestamps, SAPI-synthesized speech
   with measured word timings + planted pauses/fillers, plus a manifest of
   expected analysis results. Deterministic (tested).
7. **Docs** — PRD, ENVIRONMENT (probed tool versions), ARCHITECTURE
   (component diagram + data flow), DECISIONS (ADR-0001..0011), PROGRESS,
   KNOWN_GAPS (G-001..G-007 with plans), this report.

## How to run it

```bash
pnpm install          # pnpm 11 (packageManager-pinned)
pnpm dev              # stack up: embedded Postgres :54333 + API :8787
pnpm test             # 88 tests: schemas contracts, API (real Postgres), fixtures
pnpm gen              # regenerate contract artifacts
pnpm schemas:check    # CI drift gate
pnpm fixtures         # regenerate synthetic media + manifest
```

## Test results (measured)

| Suite | Result | Notes |
| --- | --- | --- |
| Schemas contract tests | 69/69 pass | every op type, Brief, jobs, tools, routes; Ajv validation of generated artifacts; gen:check |
| API tests | 14/14 pass | embedded Postgres, real migrations, idempotency replay, error envelopes |
| Fixtures tests | 5/5 pass | determinism across two full regenerations; media decodes; planted ground truth present |
| Lint / typecheck | pass | eslint 9 flat, strict TS with noUncheckedIndexedAccess |
| `pnpm dev` smoke | pass | healthz/readyz/contract_version; project create+replay+get over HTTP |

## Measured numbers (honest)

- Full fixture regeneration: ~26 s per run (schemas SAPI at rate 2, 640x360).
- Cold `pnpm dev` → API listening: ~15 s (fresh cluster init included).
- Schemas gen: < 5 s for the full artifact set.

No PRD performance targets are claimed at M0 (they belong to M2/M4/M9 with
the benchmark harness); nothing here is simulated.

## Known gaps

See `docs/KNOWN_GAPS.md` (G-001 Docker absent → embedded Postgres; G-002
embedded-postgres prerelease pin; G-003 SAPI-only speech fixtures; G-004 API
skeleton; G-005 workers not yet scaffolded; G-006 scaffold packages; G-007
quarantined parallel draft per ADR-0010).

## ADRs added

0001 embedded-Postgres dev stack · 0002 seconds (contracts) vs epoch-ms
(storage) · 0003 single Zod contract source · 0004 node-pg-migrate · 0005
pnpm scripts as canonical entry points · 0006 vitest workspace · 0007 stable
ID format · 0008 SAPI fixtures with tone-burst fallback · 0009 Python workers
as separate uv project · 0010 parallel-draft reconciliation (quarantine) ·
0011 MCP tool definitions as enforced data.

## Checkpoint

M0 is done per the acceptance criteria. Requesting go-ahead to start M1
(timeline engine: operations, inverses, ripple, snapping, undo/redo,
property-based tests, 95%+ coverage on `packages/core`).
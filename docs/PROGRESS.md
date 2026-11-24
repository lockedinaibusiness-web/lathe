# Lathe Progress

Updated at every milestone and every checkpoint. Rule 6.

## Current position

**Milestone 1 (Timeline engine): complete.** M2 (ingest and index) is next —
not a checkpoint milestone, so work continues.

## Done (verified, not claimed)

- **M0 scaffold**: pnpm monorepo (11 workspaces), vitest workspace, eslint 9
  flat config, prettier, strict TS; CI (GitHub Actions, ubuntu + windows).
- **Contracts** (`packages/schemas`): 19 operations with metadata registry,
  Brief (levels/ranges/readiness), job envelopes + per-type payloads, 21 MCP
  tools via `defineTool` (invariants enforced at import), HTTP route table,
  style recipes, render presets, verification findings, error catalog.
- **Generation**: `pnpm gen` → JSON Schema set + bundle + OpenAPI 3.1 + MCP
  manifest + docs index; `pnpm schemas:check` is drift-proofed by a test.
- **API skeleton** (`packages/api`): Fastify, health/readiness/contract version,
  projects CRUD with idempotent replay, FS storage with signed URLs,
  idempotency_keys migration.
- **Local stack without Docker** (ADR-0001): `pnpm dev` = embedded Postgres +
  migrations + API; verified live over real HTTP (healthz/readyz/create/
  replay/get).
- **Fixtures**: deterministic generator (SAPI speech with measured word
  timings, tone with planted silences, scene cuts, frame-numbered pattern) +
  manifest; determinism tested (byte-identical across runs); generation 5 s
  after the spawn-count rewrite (was 110 s).
- **Timeline engine** (`packages/core`): all 19 operations with structural
  pre-image inverses (ADR-0012/13/14), snapping with reports, atomic
  ≤500-op batches, undo/redo, 98.06% line coverage. 179/179 workspace tests.
- **Published**: private GitHub repo `lockedinaibusiness-web/lathe` (main).

## Next

- **M2 Ingest and index**: chunked resumable upload, proxy generation,
  word-level transcription, diarization with single-speaker fallback, shot
  detection, silence/loudness/beat analysis, progressive Brief readiness.
  `/workers` (uv, Python) consumes the M0 job contracts.
  Blocked on: nothing.

## Blockers

- None. (Environment constraints are recorded as gaps, not blockers:
  no Docker, CPU-only — see KNOWN_GAPS.)
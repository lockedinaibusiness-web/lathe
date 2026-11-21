# Lathe Progress

Updated at every milestone and every checkpoint. Rule 6.

## Current position

**Milestone 0 (Foundations and contracts): complete, awaiting checkpoint.**
Next up: M1 Timeline engine (`packages/core`).

## Done (verified, not claimed)

- **M0 scaffold**: pnpm monorepo (11 workspaces), vitest workspace, eslint 9
  flat config, prettier, strict TS; CI (GitHub Actions, ubuntu + windows).
- **Contracts** (`packages/schemas`): 16 operations with metadata registry,
  Brief (levels/ranges/readiness), job envelopes + per-type payloads, 21 MCP
  tools via `defineTool` (invariants enforced at import), HTTP route table,
  style recipes, render presets, verification findings, error catalog.
- **Generation**: `pnpm gen` → JSON Schema set + bundle + OpenAPI 3.1 + MCP
  manifest + docs index; `pnpm schemas:check` is drift-proofed by a test.
- **API skeleton** (`packages/api`): Fastify, health/readiness/contract version,
  projects CRUD with idempotent replay, FS storage with signed URLs,
  idempotency_keys migration.
- **Fixtures**: deterministic generator (SAPI speech with measured word
  timings, tone with planted silences, scene cuts, frame-numbered pattern) +
  manifest; determinism tested (byte-identical across runs).
- **Green**: `pnpm lint`, `pnpm typecheck`, `pnpm test` (88/88), `pnpm dev`
  (real HTTP round-trip), `pnpm gen`.

## Next

- **M1 Timeline engine**: timeline model, all 16 operations + inverses, ripple,
  snapping, undo/redo, grouping; property-based apply/inverse round trips;
  500-op atomic batches; 95%+ coverage on core. Blocked on: nothing.

## Blockers

- None. (Environment constraints are recorded as gaps, not blockers:
  no Docker, CPU-only — see KNOWN_GAPS.)
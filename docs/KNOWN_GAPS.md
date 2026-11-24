# Lathe Known Gaps

Everything incomplete, stubbed, deferred, or measured-and-missed lives here.
Rule 3: nothing here may be presented as done. Reviewed at every milestone.

## M0 (current)

| ID | Gap | Impact | Plan |
| --- | --- | --- | --- |
| G-001 | Docker not installed on the primary dev machine; `pnpm dev` uses embedded Postgres + FS storage instead of the compose stack | Local dev cannot exercise Redis/MinIO paths | Compose file exists for parity; Redis/MinIO adapters land in M2 when the workers need them |
| G-002 | `embedded-postgres` ships only prereleases; pinned `17.5.0-beta.15` | Supply-chain churn risk in dev deps | Re-evaluate pin each milestone; swap for Docker Postgres on machines that have it |
| G-003 | Fixture speech uses Windows SAPI; non-Windows runners fall back to tone bursts | ASR word-accuracy tests (M2) are only meaningful on the SAPI path | M2 adds a small CC0 speech fixture (or records the gap permanently) |
| G-004 | `packages/api` is a skeleton: health/readiness/projects only | No analysis, edits, render endpoints yet | M2 adds ingest; M6 completes the API surface |
| G-005 | `/workers` is not yet scaffolded (arrives with M2) | Python analysis contracts exist only as JSON Schema | M2 creates the uv project and validates payloads against the bundle |
| G-006 | Scaffold packages (core/brief/verify/render/mcp-server/sdk/web/bench) ship configs only | Nothing to import yet | Each lands with its milestone (M1-M9) including typecheck scripts |
| G-007 | Quarantined parallel draft in `packages/schemas/quarantine/` (ADR-0010) | Dead bytes in the tree; risk of accidental import | Keep until M1 ships core; delete once superseded patterns are confirmed unused |

## Measured results (M0, this machine — i3-1215U, 8 GB, CPU-only)

| Measurement | Value | Notes |
| --- | --- | --- |
| Schemas contract tests | 69/69 pass | includes gen:check and Ajv sample validation |
| API tests (embedded Postgres) | 14/14 pass | real migrations, real idempotency replay |
| Fixtures regeneration (full set) | ~5 s per run | two consecutive runs byte-identical manifest |
| `pnpm dev` cold start | ~15 s to API listening | includes cluster init on a fresh data dir |
| Workspace test suite | 179/179 pass in ~40 s | schemas + core + api + fixtures |
| Core coverage | 98.06% lines / 97.26% funcs / 85.93% branches | branch threshold set to 85 (remainder are defensive checks the snap layer already enforces) |

## M1 additions

| ID | Gap | Impact | Plan |
| --- | --- | --- | --- |
| G-008 | Core has no persistence: history/inverses live in memory | Undo/redo is per-process | M6 wires `EditHistory` + `applyBatch` to the `timeline_versions`/`operation_groups` tables (M0 migration) |
| G-009 | Branch coverage 86% (defensive bounds checks unreachable via the public API) | Cosmetic for the acceptance criterion | Accept; revisit if any check becomes reachable |
| G-010 | SAPI synthesis needs one PowerShell process with fresh instances per word | Fixtures are Windows-only for ASR-quality speech (G-003) | M2 adds a small CC0 corpus so ASR accuracy tests are platform-independent |
| G-011 | ffmpeg/ffprobe spawns cost ~3 s each on this machine (AV scanning) | Anything spawning per-item is slow | Fixture generator batches work into single invocations; M4 render planner must do the same |
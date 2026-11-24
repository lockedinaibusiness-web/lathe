# Lathe Architecture Decision Records

One ADR per decision. Context → Decision → Consequences. ADR numbers are
permanent. When this prompt (AGENTS.md) is silent on a technical choice, the
decision is recorded here and work continues.

---

## ADR-0001: Local dev stack without Docker (embedded Postgres)

Date: 2026-11-21 · Status: accepted

**Context.** The master build prompt specifies docker-compose (Postgres, Redis,
MinIO) for infra, and `make dev`/`pnpm dev` must bring up the full stack on a
laptop. The primary dev machine has no Docker installed (see
docs/ENVIRONMENT.md), so the compose path cannot be the local entry point.

**Decision.** Local dev runs Postgres via the `embedded-postgres` npm package
(user-space binaries, no admin rights, no Docker) started by `scripts/dev.mjs`,
which then runs migrations and boots the API. Storage uses an FS-backed adapter
with HMAC-signed expiring URLs (`packages/api/src/storage.ts`).
`infra/docker-compose.yml` remains the parity stack for machines with Docker
and for CI service containers. Redis/MinIO arrive with the workers (M2+), and
the compose file is the parity path for those.

**Consequences.**
- `pnpm dev` works natively on Windows/macOS/Linux with one command.
- Two storage implementations exist (FS local, S3/MinIO in compose mode); the
  `StorageAdapter` interface keeps them interchangeable.
- `embedded-postgres` ships only prereleases; pinned to `17.5.0-beta.15`
  (the version this repo's lockfile resolves). Flagged in KNOWN_GAPS for
  periodic review.
- CI (ubuntu-latest) uses the same embedded-postgres path — no service
  containers needed for M0-M5; compose parity is exercised manually.

---

## ADR-0002: Time values are seconds (float) in contracts, epoch-ms in storage

Date: 2026-11-21 · Status: accepted

**Context.** The master prompt's Brief shape specifies `words: [{w, s, e, c}]`
and `duration_s` — decimal seconds. A parallel draft (see ADR-0010) used integer
milliseconds everywhere.

**Decision.** All external contracts (operations, Brief, findings, render
requests/responses) use **decimal seconds** as floats, matching the prompt.
Database columns store **unix epoch milliseconds as bigint** (`created_ms`,
`updated_ms`), because Postgres bigint arithmetic is exact and existing
migrations use it. Conversion happens at the API boundary only.

**Consequences.** No floating-point drift in storage; the model-facing surface
matches the documented shapes; `toInt()` helper in `packages/api/src/db.ts`
normalizes bigint strings from node-postgres.

---

## ADR-0003: Single Zod schema graph is the only contract source

Date: 2026-11-21 · Status: accepted

**Context.** Working rule 7: contracts are defined once and generated into
types/validators/docs; never hand-duplicated.

**Decision.** `packages/schemas` holds every cross-service contract as Zod v4
schemas: operations, Brief, job envelopes, MCP tools, HTTP routes, styles,
render presets, verification findings, error catalog. One script
(`packages/schemas/scripts/generate.ts`, `pnpm gen`) emits:
- `packages/schemas/generated/json-schema/*.schema.json` (per contract),
- `packages/schemas/generated/lathe.contracts.schema.json` (bundle with
  `definitions`, registered with Fastify for response serialization),
- `docs/generated/openapi.json` (OpenAPI 3.1 from the route table),
- `docs/generated/mcp-tools.json` (MCP tool manifest for the fallback path),
- `docs/schemas/INDEX.md` (human index with content hashes).

`pnpm schemas:check` (generator `--check`) fails CI on any drift between
schemas and committed artifacts (tested in `tests/generated.test.ts`).

**Consequences.** Zod v4 is mandatory (native `z.toJSONSchema`); the API never
hand-writes response schemas; adding a contract field is a one-line change plus
`pnpm gen`.

---

## ADR-0004: node-pg-migrate for Postgres migrations

Date: 2026-11-21 · Status: accepted

**Context.** The prompt leaves the migration tool open (record in ADR).

**Decision.** `node-pg-migrate` with CommonJS migration files under
`packages/api/migrations/`. Chosen because it is plain SQL-shaped JavaScript
(no DSL), versioned by filename, and has no server component. It is invoked
through `createRequire` (CJS `export =` interop) in `packages/api/src/migrate.ts`.

**Consequences.** Migrations are reviewable JS; `pnpm db:migrate` applies them;
`pnpm dev` applies them automatically on boot.

---

## ADR-0005: `pnpm` scripts are the canonical entry points (no make on Windows)

Date: 2026-11-21 · Status: accepted

**Context.** The prompt says "make dev (or pnpm dev)". `make` is not installed
on the primary dev machine (Windows 11).

**Decision.** All entry points are pnpm scripts in the root package.json
(`dev`, `test`, `lint`, `typecheck`, `gen`, `schemas:check`, `fixtures`,
`db:migrate`, `infra:up/down`). A `Makefile` mirrors them for POSIX users and
documents the mapping. CI calls the pnpm scripts.

**Consequences.** Windows developers are first-class; the Makefile is a thin
shim and cannot drift (it contains no logic).

---

## ADR-0006: Vitest workspace at the repo root

Date: 2026-11-21 · Status: accepted

**Context.** Multiple packages (schemas, api, fixtures) each run tests with
different needs (node env, embedded Postgres, long fixture generation).

**Decision.** Root `vitest.workspace.ts` lists `packages/*`, `bench`, and
`fixtures`; each project keeps its own `vitest.config.ts` (timeouts, includes).
`pnpm test` runs the whole workspace; per-package `vitest run` still works.

**Consequences.** One command runs everything; per-project isolation keeps the
slow fixtures/API suites from affecting fast contract tests.

---

## ADR-0007: Stable ID format `prefix_base32`

Date: 2026-11-21 · Status: accepted

**Context.** Invariant #1 requires stable IDs for every entity; they appear in
URLs, FFmpeg arguments, logs, and the Brief.

**Decision.** IDs are `<2-3 letter prefix>_<10-64 Crockford-base32 chars>`
(e.g. `prj_01J8ZQ4K2M9T3X7YB6N0PWABCD`). Prefixes are a closed set
(`packages/schemas/src/ids.ts`); `generateId(prefix, rng)` mints them with an
injectable RNG for tests; `sampleId(prefix, n)` gives deterministic fixture IDs
(`prj_SAMPLE000001`). ID prefixes never renumber.

**Consequences.** Logs and URLs are safe (no shell metacharacters); tests and
fixtures are deterministic; the ID pattern is enforced by schema validation.

---

## ADR-0008: Fixture speech via Windows SAPI with tone-burst fallback

Date: 2026-11-21 · Status: accepted

**Context.** M2 acceptance needs word timings within 100 ms of ground truth,
which requires *real speech with known text*. No CC0 speech corpus is bundled;
the machine has Windows SAPI voices installed.

**Decision.** `fixtures/generate.mjs` synthesizes each fixture word separately
via `System.Speech.Synthesis` at rate 2, trims silence, measures the actual
duration, and schedules words on a fixed timeline (120 ms gaps, planted 1.2 s
pause before a planted "um" filler, planted 0.9 s silence before a chosen
word). The manifest records measured timings as ground truth. On non-Windows
runners each word becomes a tone burst of a length derived from its spelling —
same schedule, same manifest, no SAPI dependency (flagged in KNOWN_GAPS: tone
bursts are not speech, so M2 ASR accuracy tests are Windows/SAPI-only until a
CC0 corpus lands).

**Consequences.** Word timing ground truth is exact (measured, not assumed);
fixtures are deterministic (twice-generated manifests are byte-identical —
tested); ASR tests must run on the SAPI path or with a corpus.

---

## ADR-0009: Python workers are a separate uv project consuming the same JSON contracts

Date: 2026-11-21 · Status: accepted

**Context.** The prompt puts Python workers in `/workers` managed by `uv`,
consuming the same job contracts as the TypeScript services.

**Decision.** `/workers` is its own uv project (not part of the pnpm
workspace). It validates against the generated JSON Schemas
(`packages/schemas/generated/*.schema.json`) rather than re-declaring shapes.
Python 3.11+ is the requirement; the dev machine has 3.13.7 (satisfies it;
wheel availability for ML deps is verified in M2 before pinning).

**Consequences.** One contract source, two languages; workers can be developed
and tested independently; `uv` (0.13.8 present on the dev machine) manages
Python deps.

---

## ADR-0010: Reconciling the parallel M0 draft (quarantine, not delete)

Date: 2026-11-21 · Status: accepted

**Context.** During M0, two working sessions produced overlapping artifacts:
an earlier overnight draft of `packages/schemas` (millisecond-based contracts,
`ERROR_CATALOG`, a 46 KB monolithic `tools.ts`, plus `projects.ts`/`timeline.ts`/
`assets.ts`) and this session's contracts per the master prompt (seconds-based
Brief, `ErrorCodes` catalog, 21-tool registry split across `tools_a/b/c.ts`).
Both could not coexist: rule 7 forbids duplicated contracts.

**Decision.** The prompt-aligned contracts in `packages/schemas/src/` are the
single source. The parallel draft is preserved untouched in
`packages/schemas/quarantine/` (excluded from build/lint) with a README
explaining provenance, so nothing is destroyed and the work can be mined later.
The parallel session's *infrastructure* work (Fastify API, embedded-Postgres
dev loop, migrations, CI) was adopted and adapted (ADR-0001/0004), and its API
was corrected against actual library behavior (embedded-postgres has no
`database` option; node-pg-migrate interop needs `.default` via createRequire).

**Consequences.** No duplicated contracts; the API and migrations are real and
tested; the quarantined draft is reference-only and must not be imported.

---

## ADR-0011: MCP tool definitions are data with enforced invariants

Date: 2026-11-21 · Status: accepted

**Context.** PLG-5 requires every tool to have a precise description with
worked examples, strict schemas, a `summary` field, and error codes with
`suggested_fix`. Hand-maintaining 21 tools drifts.

**Decision.** Tools are declared via `defineTool()` in
`packages/schemas/src/mcp/`, which fails fast at import time if a tool has
< 2 examples, an output without `summary`, an unknown error code, or claims
non-read-only without idempotency. `tests/tools.test.ts` additionally asserts
every example input parses against the tool's input schema.

**Consequences.** Tool descriptions/examples are test-enforced; the MCP server
(M6) registers handlers against this registry with zero re-declaration.

---

## ADR-0012: Engine inverse operations complete the operation vocabulary

Date: 2026-11-22 · Status: accepted

**Context.** Invariant #2 requires every operation to be invertible, and M1's
acceptance property test must prove apply-then-inverse returns a
byte-identical timeline. The 16 public operations invert to public operations
in most cases (trim back with ripple, delete the split's new clip, restyle
with prior values), but structural restores have no public expression:
re-inserting a deleted clip with its exact pre-image and captions, removing a
caption, removing an overlay. A `none` transition kind is also needed to
express "no transition" on restore. The master prompt explicitly allows
refining the operation shapes ("You will write the complete schemas. Start
from these shapes and refine them.").

**Decision.** Extend the operation union with three engine-level operations —
`restore_clip` (re-inserts a captured clip/caption pre-image at a recorded
position, optionally rippling), `remove_caption`, `remove_overlay` — plus a
`none` value in the transition kind enum. The core engine computes and emits
these as the `inverse` of delete/add operations; they are fully validated
public operations, and the review UI shows them as labeled undo groups.

**Consequences.** Inverses are first-class operations, so undo is "apply the
stored inverse batch" and redo is "re-apply the original batch" — both go
through the same validation and history paths as model-issued edits. Three
extra operation types exist in the contract; models can technically issue
them (harmless — restore of a non-existent clip fails with OP_CONFLICT).

---

## ADR-0013: Inverses must restore exactly, so state is null-based and snapping is exact for engine ops

Date: 2026-11-22 · Status: accepted

**Context.** With structural inverses (ADR-0012), "byte-identical" means
optional state must be restorable exactly: `undefined` (absent) cannot be
expressed by a public op that always writes a value, and raw-timecode
snapping (ADR default policy) could MOVE a restored position (mid-word
avoidance, silence preference, frame grid), silently breaking round trips.

**Decision.** Two rules in the timeline model:
1. **Null-based state.** Clip `reframe`, `zoom`, `transition`, `audio` and
   track/project `audio` are `T | null` — explicitly null when unset — so
   inverses write exact values. Audio gain is always present (default 0 dB).
2. **Exact snap policy for inverses.** The engine resolves inverse time
   references with `EXACT_POLICY` (`avoid_mid_word:false`, `prefer_silence:false`,
   huge tolerance). In `resolveAndSnap`, an exact policy skips word/silence/
   frame snapping entirely and returns the recorded value. Time references
   inside inverses are also expressed as clip-edge references where possible
   (`kind: "clip"` resolves exactly by construction).

**Consequences.** Property tests can prove byte-identical round trips for all
19 operations. Public ops keep the normal snap policy; only engine-emitted
inverses use the exact policy. Ops that need to express "unset" carry small
additive flags: `reframe.reset`, `zoom.reset`, `duck_audio.clear`,
`normalize_audio.clear`, and `style_caption` takes nullable `style_id`/
`overrides` (explicit null clears).

---

## ADR-0014: Engine inverses restore full pre-images; time values are quantized to microseconds

Date: 2026-11-24 · Status: accepted

**Context.** During M1, positional inverses (trim-back with ripple, reorder
with re-pack, set_speed with ripple) failed the property test: converting
timeline positions back to source positions through an irrational speed
(e.g. 1.253811) accumulates float error (`8` restored as `7.999999999999999`),
and re-packing a track whose membership changed repositions clips that were
not part of the op. Snap-time checks also rejected legitimate extensions
because the engine compared against the clip's trimmed range instead of the
source duration.

**Decision.** Four changes in `packages/core`:
1. **Pre-image inverses.** The inverse of every mutating operation
   (trim/split/set_speed/reorder) is a batch of `restore_clip` ops carrying
   the exact pre-images of all affected clips; `restore_clip` REPLACES an
   existing clip in place (order untouched, no ripple) or re-inserts a
   deleted clip at its recorded position and `order_index`. No arithmetic,
   no drift — state is restored verbatim.
2. **Microsecond quantization.** Every time value written by the engine
   (`q()` in timeline.ts) rounds to 1e-6 s with SYMMETRIC rounding, so
   forward and inverse arithmetic cancel exactly. Ripple comparisons use a
   1 µs epsilon.
3. **Source-media bounds.** Trim validation compares against
   `ctx.source.duration_s`, not the clip's current trimmed range (a trimmed
   clip can be extended back into media it still has).
4. **Virtual B-roll track.** B-roll clips (`is_broll`) project onto a derived
   track (`trk_BROLLVIRTUAL00001`) that is never stored in `timeline.tracks`,
   so insert/delete never mutate the stored track set and the model stays
   canonical.

**Consequences.** Invariant #2 holds for all 19 operations under
property-based testing (250 random timelines × random op streams, 4
properties, run repeatedly). Undo is "apply the stored inverse batch" — the
same validation and history path as model edits. Pre-image inverses are
self-describing for the review UI. Cost: inverses of track-wide ops emit one
restore per clip (bounded by track length; batches cap at 500 ops).
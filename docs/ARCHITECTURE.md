# Lathe Architecture (Milestone 0 view)

The governing idea: **the model edits the project, not the pixels.** The model
reads a compact text description (the Brief), issues batched invertible
operations against stable IDs, and the engine renders.

## Component diagram

```
                         ┌──────────────────────────────┐
                         │        Model (BYO)           │
                         │  Claude / GPT / Gemini / ... │
                         └───────────┬──────────────────┘
                                     │ MCP (streamable HTTP / stdio)
                                     │ OAuth 2.1, per-project scopes
                                     ▼
┌─────────────┐   REST/OpenAPI   ┌──────────────────────────────┐
│  Web review │◄────────────────►│  Gateway / HTTP API (Fastify)│
│  UI (M8)    │  API keys        │  auth · idempotency · jobs   │
└─────────────┘                  └───────────┬──────────────────┘
                                             │ validates via
                                             ▼
                              ┌──────────────────────────────┐
                              │  @lathe/schemas (Zod v4)     │
                              │  operations · Brief · jobs   │
                              │  MCP tools · HTTP routes     │
                              │  styles · presets · errors   │
                              └───┬──────────┬──────────┬────┘
                                  │          │          │ generated artifacts
                                  ▼          ▼          ▼
                        JSON Schema   OpenAPI 3.1   MCP manifest
                        (+ bundle)    docs/gen      docs/gen
                                  │
        ┌─────────────────────────┼─────────────────────────────┐
        ▼                         ▼                             ▼
┌───────────────┐      ┌────────────────────┐        ┌───────────────────┐
│ @lathe/core   │      │  Project service   │        │  Index + Brief    │
│ timeline, ops│      │  timeline store,   │        │  service          │
│ inverses,    │      │  history, groups   │        │  Briefs, search   │
│ undo/redo (M1)│     │  (M6)              │        │  (M3)             │
└──────┬────────┘      └─────────┬──────────┘        └─────────┬─────────┘
       │                         │                             │
       │              ┌──────────▼──────────┐                  │
       │              │  Postgres (embedded │                  │
       │              │  locally, compose   │                  │
       │              │  in CI/prod)        │                  │
       │              └─────────────────────┘                  │
       │                                                       │
       ▼                                                       ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Job queue (Redis + BullMQ; M2+) — same contracts to Python workers  │
│  /workers (uv): transcribe · diarize · shots · audio · embeddings    │
└───────────────────────────────┬───────────────────────────────────────┘
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Render service (M4): full re-encode → smart render (GOP stream-copy) │
│  chunk-parallel · content-hash cache · previews from proxies         │
│  Verification (M5): deterministic checks → findings → auto-fix loop   │
└───────────────────────────────┬───────────────────────────────────────┘
                                 ▼
                    Object storage (MinIO/S3; FS locally)
                    signed, expiring URLs only
```

## Data flow: one edit session

1. **Upload** (M2): chunks land via signed URLs; analysis jobs start on first
   chunks. Proxy (720p all-intra) generated in parallel.
2. **Index**: transcription, diarization (single-speaker fallback), shots,
   silence/loudness/beats stream into Postgres; the Brief becomes queryable
   progressively (readiness flags per section).
3. **Brief**: the model calls `get_brief` (summary < 8k tokens for 60 min;
   standard < 60k). Ranges and detail levels zoom on demand.
4. **Plan + apply**: `plan_edit` returns server-side recipe steps; the model
   emits `apply_edits` (≤ 500 ops, atomic, idempotent, one rationale per
   group). Raw timecodes snap to word/frame boundaries; snaps are reported.
5. **Verify**: deterministic checks run on a fresh render; findings carry
   `suggested_fix`; up to 3 auto-fix passes.
6. **Preview + render**: proxy preview in seconds; full render stream-copies
   unchanged GOPs; cache keyed by content hash (timeline + asset hashes +
   preset).
7. **Review + export**: web UI shows every AI change with rationale;
   accept/reject/revert; export OTIO/FCPXML/EDL/SRT/VTT.

## Milestone map (what exists today)

| Milestone | Package | Status |
| --- | --- | --- |
| M0 foundations | schemas, api (skeleton), fixtures, infra, CI | **this checkpoint** |
| M1 timeline engine | core | next |
| M2 ingest/index | workers (Python) + api | after M1 |
| M3 Brief/search | brief | after M2 |
| M4 render | render | after M3 |
| M5 verification | verify | after M4 |
| M6 MCP + full API | mcp-server, api, sdk, bench harness | after M5 |
| M7 styles/autopilot | styles data + core/verify loop | after M6 |
| M8 review UI | web | after M7 |
| M9 benchmarks/CI gates | bench | after M8 |

## Local stack (today, no Docker)

`pnpm dev` → embedded Postgres 17 (user-space, `.services/pg`) → migrations
(`packages/api/migrations/0001_init.cjs`) → Fastify API on :8787:
`/healthz`, `/readyz`, `/v1/__contract_version`, `/v1/projects`.
Storage: FS adapter, HMAC-signed URLs. `infra/docker-compose.yml` provides the
Postgres/Redis/MinIO parity stack for Docker machines and future services.
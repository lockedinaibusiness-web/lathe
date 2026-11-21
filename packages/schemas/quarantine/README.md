# Quarantine: competing schemas draft (superseded)

These files are a complete parallel draft of the schemas package written by an
earlier working session (timestamps 00:34-01:12, before the contracts in
`../src/`). They use a different internal vocabulary:

- `Ms` (integer milliseconds) instead of seconds for all time fields,
- `ERROR_CATALOG`, `sampleId`, `UploadSessionId`, `BriefQuery`, `OpBatch`,
  `ApplyEditsResult`, `JobAccepted`, `StyleListResult`, `Scope` instead of the
  current names in `../src/`,
- milliseconds-based Brief/search/render contracts.

The master build prompt (AGENTS.md / DECISIONS) defines the current contracts
(`Brief` with `words: [{w,s,e,c}]` seconds, `ErrorCodes` catalog, etc.), and
`../src/` implements that design. Rather than delete the earlier work
(working rule: never destroy potential user work), it is preserved here
untouched and excluded from build/lint.

See `docs/DECISIONS.md` ADR-0010 for the full context and how to reclaim
anything from this draft.

Status: reference only. Do not import from this directory.
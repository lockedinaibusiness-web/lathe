# Milestone 1 report — Timeline engine

**Status: complete** (not a checkpoint milestone; M2 follows immediately).
Date: 2026-11-24. Machine: Windows 11, Node 24.17.0, FFmpeg 9.0.2, no Docker.

## What was built

**`packages/core`** — the pure-TS, zero-I/O timeline engine (EDT-1..EDT-7):

- **Timeline model** (`src/timeline.ts`): tracks (video/audio/caption), clips
  (source range + speed + reframe/zoom/transition/audio state + overlays),
  captions (absolute timeline seconds, attached to a clip), null-based
  optional state, microsecond-quantized time writes, virtual B-roll track.
- **All 19 operations** with structural inverses (invariant #2):
  16 public ops from EDT-2 + 3 engine-inverse ops (`restore_clip`,
  `remove_caption`, `remove_overlay`, ADR-0012) + `none` transition kind.
  Cut/arrange: split, trim (ripple default, invariant #5), delete,
  ripple_delete, reorder (cross-track, re-pack), set_speed (ripples by
  duration delta). Visual: reframe, zoom, add_transition. Caption: add,
  style (nullable clears), remove. Overlay: add, remove. Audio: set_gain,
  duck_audio (clip/track/project scopes), normalize_audio. Insert: b-roll
  (asset/search/stock sources). Each returns `{timeline, inverse, created,
  snaps}`.
- **Snapping** (`src/snap.ts`): TimeSpec kinds (word/clip/frame/seconds),
  policy = never mid-word, prefer silence (points already inside a pause are
  held), frame grid for free values, exact policy for engine inverses;
  `SnapReport` on every resolution (invariant #1); tolerance default 40 ms,
  `OP_SNAP_AMBIGUOUS` beyond it (invariant #6).
- **Atomic batches** (`src/batch.ts`): simulate-then-commit, ≤ 500 ops
  (invariant #3), per-op results with snap reports and error codes +
  suggested_fix, version conflicts, dry-run, LIFO batch inverse.
- **Undo/redo** (`src/history.ts`): linear history of labeled batches;
  undo/redo by last-N, group, or batch id (EDT-6); newer-first enforcement.

**Contracts refined** (`packages/schemas`, regenerated): 3 engine-inverse
ops + `none` transition, `ClipPreImage` accepting `asset_ref` for B-roll,
`order_index` on restore, additive `reset`/`clear` flags, nullable
`style_caption` fields. ADRs 0012-0014 record the why.

## How to run it

```bash
pnpm --filter @lathe/core test            # 91 core tests
pnpm --filter @lathe/core test:coverage   # coverage report
pnpm test                                  # full workspace: 179 tests
```

## Test results (measured)

| Suite | Result |
| --- | --- |
| Core suite (`vitest run`) | **91/91 pass** (~4 s) |
| Workspace (`pnpm test`) | **179/179 pass** (~40 s) |
| Property-based inverses (invariant #2) | **pass** — 250 random timelines × random op streams, single-op and sequence LIFO drains, plus input-immutability; re-run 4× to stability |
| Batch atomicity | **pass** — reject-on-failure leaves the input byte-identical; 500-cap enforced at exactly 500/501 |
| Snapping | **pass** — mid-word avoidance, silence preference, tolerance rejection, exact-policy restores |
| Coverage (core) | **98.06% lines / 97.26% funcs / 98.06% stmts / 85.93% branches** (thresholds: 95/95/95/85) |
| Lint / typecheck / gen:check | **pass** |

## Bugs the tests caught (all fixed, all with regression tests)

1. Trim with `ripple: false` mutated the caller's timeline (aliased input).
2. Ripple comparisons missed by 5e-7 s against unquantized clip ends
   (epsilon fixed to the quantization unit).
3. Float drift through irrational speeds on positional inverses
   (fixed by pre-image inverse + symmetric quantization, ADR-0014).
4. Trim bounds compared against the clip's trimmed range instead of the
   source duration (rejected legitimate extensions).
5. `q()` rounded halves asymmetrically, so inverse arithmetic didn't cancel.
6. Reorder inverses didn't restore track order (order_index added).
7. B-roll restore referenced a pruned track (virtual track, ADR-0014).
8. `applyBatch` didn't return the resulting timeline; empty batches are now
   rejected.
9. SAPI single-instance file retargeting corrupted WAV headers; fixture
   generator rewritten to fresh-instance-per-word in one process
   (**fixture generation 110 s -> 5 s; fixtures suite 226 s -> 13 s**).

## Known gaps

- Branch coverage 85.9%: the remainder are defensive bounds checks the snap
  layer already enforces (unreachable via the public API); the acceptance
  criterion (line coverage) is exceeded at 98.1%.
- Inverses of track-wide ops emit one `restore_clip` per affected clip —
  bounded by track length, documented in ADR-0014.
- No undo/redo persistence yet (Postgres tables exist from M0; the API
  wires history in M6).

## ADRs added

0012 engine-inverse operation vocabulary · 0013 null-based state + exact
snap policy for inverses · 0014 pre-image inverses + microsecond
quantization + source-media bounds + virtual B-roll track.

**Next: M2 (ingest and index)** — chunked resumable upload, proxy
generation, transcription/diarization/shots/audio workers in `/workers`
(uv), progressive Brief readiness.
# Lathe fixtures

Deterministic synthetic media with known ground truth, so M2-M5 tests assert
accuracy against a manifest instead of eyeballing output.

## Generate

```bash
pnpm fixtures          # or: node fixtures/generate.mjs [all|pattern|tone|scenes|speech]
```

Outputs land in `fixtures/out/` (gitignored — regenerate any time; CI runs
`pnpm fixtures:gen` before tests). Two consecutive runs produce a
byte-identical `manifest.json` (asserted by `fixtures/generate.test.ts`).

## What is generated

| Fixture | Ground truth in the manifest | Used by |
| --- | --- | --- |
| `pattern.mp4` | 30 s, 30 fps, 900 frames, frame number burned in | frame-exact queries, black-frame checks |
| `tone.mp4` | 1 kHz tone; silences at 10.0-12.0 s and 25.0-27.5 s (50 ms tolerance) | silence/loudness analysis (M2/M5) |
| `scenes.mp4` | 5 color segments; cuts at 5/10/15/20 s (66 ms tolerance) | shot detection (M2) |
| `speech.wav` / `speech.mp4` | 28 words with measured start/end; filler "um"; planted 1.2 s pause and 0.9 s silence | transcript timing accuracy (M2) |

## Manifest shape

```json
{
  "version": "1.0.0",
  "fps": 30,
  "resolution": { "width": 640, "height": 360 },
  "fixtures": { "pattern": { "path": "...", "duration_s": 30, "expected": { ... } } },
  "speech": {
    "source": "windows-sapi",
    "words": [{ "w": "welcome", "s": 0.2, "e": 0.615, "c": 1 }],
    "planted_pauses": [{ "s": 6.895, "e": 8.095, "kind": "planted_pause", "before": "um" }],
    "word_timing_tolerance_ms": 100,
    "silence_tolerance_ms": 50
  }
}
```

Word timings are **measured** from the synthesized audio (SAPI at rate 2,
silence-trimmed), so they are exact ground truth, not estimates. On
non-Windows runners, words become tone bursts of spelling-derived length with
the same schedule — analysis fixtures still run, but ASR accuracy assertions
are only meaningful on the SAPI path (ADR-0008, KNOWN_GAPS G-003).
# ENVIRONMENT

Recorded 2026-11-21 by the M0 session, from direct probes of the development machine.

## Machine

| Item | Value |
| --- | --- |
| OS | Microsoft Windows 11 Home Single Language, build 10.0.26200, 64-bit |
| CPU | 12th Gen Intel Core i3-1215U (2P + 8E cores, 12 threads) |
| RAM | 7.7 GB usable |
| GPU | None discrete. CPU-only processing; Intel iGPU present but untested for QSV encode |

## Toolchain (probed versions)

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | v24.17.0 | Meets `>=22` engines requirement |
| pnpm | 11.8.0 | Pinned via `packageManager` in root `package.json` |
| npm | 11.13.0 | Not used directly |
| Python | 3.13.7 | PRD stack says 3.11+; 3.13 satisfies it. ML worker dependency wheels (ctranslate2/faster-whisper, torch, librosa) to be verified in M2 before locking `workers/pyproject.toml` |
| uv | 0.13.8 | Will manage `/workers` from M2 |
| git | 2.55.0.windows.3 | Repo initialized on `main` |
| FFmpeg | 9.0.2-full_build-www.gyan.dev (gcc 16.2.0 MSYS2) | Static full build. Confirmed present in configure line: libx264, libass (caption burn-in), libfreetype/fontconfig, libsvtav1, libvpx, aac, libwhisper (unused for now) |
| ffprobe | 9.0.2 | Same build |
| Docker | **NOT INSTALLED** | `docker` is not on PATH. See ADR-0001 |
| make | **NOT INSTALLED** | `make` is not on PATH. See ADR-0005 |

## Constraints and consequences

1. **No Docker locally.** `infra/docker-compose.yml` is provided for parity and CI, but M0 acceptance ("one command brings up the stack") is met natively: embedded Postgres (user-space binaries), FS-backed signed-URL storage adapter, and the API server. See ADR-0001.
2. **No `make`.** `pnpm dev` / `pnpm test` are the canonical entry points (the master build prompt explicitly allows `pnpm dev`). A `Makefile` is provided for POSIX users. See ADR-0005.
3. **CPU-only, 8 GB RAM.** All analysis and rendering must have CPU fallbacks (already mandated). Fixture generation uses small resolutions (max 640x360) and 24-30 fps to keep test times low on this laptop.
4. **Windows TTS available for fixtures.** Windows SAPI (`System.Speech`) is used to synthesize deterministic speech for transcript fixtures. Fixture generation must also work without SAPI (Linux CI) by substituting tone bursts of identical durations; see ADR-0008.
5. **FFmpeg 9.0.2.** Fixture generation and render code must only use flags verified against this version's actual behavior (working rule 8). Flags used so far are probed in `scripts/fixtures/lib/ffmpeg.ts`.

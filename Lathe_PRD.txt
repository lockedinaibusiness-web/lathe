LATHE: PRODUCT REQUIREMENTS DOCUMENT
Hand it the footage. Get back the cut.

Version 1.0 (Draft) | November 20, 2026
Owner: Product Lead | Status: For review

================================================================
1. EXECUTIVE SUMMARY
================================================================

Lathe is an autopilot video editing service. A user uploads raw footage, connects the AI model of their choice through a plugin, and receives a finished, professionally paced edit in under a minute for typical content. The model never processes raw video frames. It reads a compact, structured description of the footage (the Brief), issues a batch of edit operations against a declarative timeline, and Lathe's render engine produces the result near-instantly using smart rendering and parallel GPU workers.

The product is built around three bets:

- Speed: editing begins before ingest finishes, and exports avoid re-encoding wherever possible.
- Model-agnosticism: any frontier model that supports MCP or function calling can drive Lathe. Users bring their own model.
- Transparency and portability: every edit is a readable plan, reviewable and reversible, and exportable to Premiere, Resolve, and Final Cut.

================================================================
2. PROBLEM STATEMENT
================================================================

Video editing is the bottleneck in nearly every content workflow. Existing solutions fall into two camps, and both fail users:

- Manual editors (Premiere, Resolve, CapCut) are powerful but slow. A 10-minute talking-head video routinely costs 2 to 4 hours of editing.
- Current AI editing tools are closed boxes. They lock users to one proprietary model, take minutes to hours to process, return a baked video that is hard to correct, and cannot be extended or automated by the user's own tools.

Meanwhile, frontier language models are now strong at planning, reading transcripts, and following editorial rules, but have no safe, fast way to act on video. The missing piece is an interface between the model and the footage.

================================================================
3. VISION, GOALS, AND NON-GOALS
================================================================

Vision: Any person with footage and any capable AI model can produce a publish-ready edit faster than they could finish describing it.

GOALS

1. Deliver a first complete edit in under 60 seconds from upload completion for a 10-minute source video.
2. Reach blind-rated edit quality at or above leading competitors and at or above a competent human editor for defined content types (podcast, talking head, tutorial, short-form clips).
3. Work with any major frontier model through MCP, with an OpenAPI/function-calling fallback.
4. Make every AI action previewable, explainable, and undoable.
5. Export to open interchange formats so users are never locked in.

NON-GOALS (v1)

- Replacing a full-featured manual NLE for complex narrative, VFX, or color-critical film work.
- Hosting or training our own frontier language model.
- Live-stream or true real-time broadcast editing.
- A social network, content marketplace, or distribution platform.
- Generating full videos from scratch (generative fills are optional and metered).

================================================================
4. TARGET USERS
================================================================

Solo creator: YouTuber or podcaster, 1 to 3 videos per week. Needs to cut hours of editing to minutes and keep their own style.

Short-form producer: Repurposes long content into clips for Reels, Shorts, TikTok. Needs to find best moments, reframe, and caption at volume.

Marketing team: In-house team producing webinars, demos, social. Needs consistent brand style and fast turnaround.

Agency / editor: Professional editor handling many clients. Needs a fast first cut that exports cleanly into their NLE.

Developer / power user: Builds automations around their own model and tools. Needs programmatic access via MCP and API.

Primary personas for v1: Solo creator and Short-form producer. Secondary: Marketing team and Agency.

================================================================
5. KEY USE CASES
================================================================

1. Podcast or interview cleanup: remove silences, filler words, and false starts; level audio; add captions.
2. YouTube retention edit: tighten pacing, cut tangents, add hook, chapters, and captions.
3. Clip extraction: from a 1-hour recording, find the 5 strongest standalone moments and output each as a vertical clip with captions.
4. Tutorial and screen recording polish: remove dead time, add zooms on activity, add step captions.
5. Multi-camera assembly: switch between angles based on active speaker.
6. Localization: translate captions and optionally dub into other languages.
7. Instruction-driven revision: after the first cut, the user says 'make the intro punchier' or 'drop the second story' and only the affected parts update.

================================================================
6. PRODUCT PRINCIPLES
================================================================

1. The model edits the project, not the pixels. All edits are operations on structured data.
2. Speed is a feature, and a budget. Every stage has a latency target that is tested in CI.
3. Reference by ID, never by guess. The model addresses segments and clips by stable ID, not hand-typed timecodes.
4. Show your work. Each edit carries a short rationale and can be accepted, rejected, or undone individually.
5. No lock-in. Users keep their media, their plan, and their choice of model.
6. Few tools, high leverage. A small tool surface is easier for every model to use correctly.

================================================================
7. END-TO-END EXPERIENCE
================================================================

1. Upload: user drags in a file, pastes a URL, or connects cloud storage. Chunked, resumable upload begins processing immediately.
2. Connect: user selects a model connection (already set up once through OAuth or API key) and picks a goal and style, or types a free-form instruction.
3. Progressive analysis: transcript and audio index appear first, visual index follows. A progress view shows what is ready.
4. Plan and apply: the model reads the Brief, proposes an edit plan, and applies it as a batch. The first preview is playable within seconds.
5. Self-check: automated verification runs; failures are returned to the model for a fix pass without user involvement.
6. Review: user sees the edit as a timeline with AI changes highlighted, each with a one-line reason. They can accept all, reject any change, or give a follow-up instruction.
7. Export: render to MP4/MOV at chosen preset, or export the project as OpenTimelineIO, FCPXML, or EDL.

================================================================
8. FUNCTIONAL REQUIREMENTS
================================================================

Priority: P0 = required for launch, P1 = required within 90 days of launch, P2 = planned.

----------------------------------------------------------------
8.1 Ingest and indexing
----------------------------------------------------------------

ING-1 [P0] Support upload of common containers and codecs (MP4, MOV, MKV, WebM; H.264, HEVC, ProRes, AV1) up to 50 GB per file.
ING-2 [P0] Chunked, resumable uploads; analysis starts on first chunks without waiting for completion.
ING-3 [P0] Generate edit proxies (720p, all-intra or short-GOP) in parallel with indexing.
ING-4 [P0] Word-level transcript with timestamps and confidence, 50+ languages.
ING-5 [P0] Speaker diarization with stable speaker IDs.
ING-6 [P0] Shot and scene boundary detection.
ING-7 [P0] Audio analysis: silence map, loudness curve, music/speech classification, beat detection.
ING-8 [P1] Visual understanding: per-shot description, face and subject presence, on-screen text (OCR), screen-recording activity detection.
ING-9 [P1] Semantic embeddings over transcript and shots for natural-language search.
ING-10 [P1] Multi-clip projects and multi-camera sync by audio waveform.
ING-11 [P1] Import from URL, Google Drive, Dropbox, S3.

----------------------------------------------------------------
8.2 The Brief
----------------------------------------------------------------

The Brief is the compact, model-readable description of a project. It is the product's most important interface.

BRF-1 [P0] Brief is plain structured text/JSON with segment IDs, speaker labels, word timings, shot list, silence and energy markers.
BRF-2 [P0] Brief for a 60-minute video must fit within 60,000 tokens at default detail, with a summary level under 8,000 tokens.
BRF-3 [P0] Brief supports detail levels (summary, standard, full) and range queries so the model can zoom into a section.
BRF-4 [P0] Brief updates incrementally as indexing progresses and flags which sections are still pending.
BRF-5 [P1] Brief includes deterministic 'editorial hints' (candidate hook moments, repeated takes, filler clusters, dead air) to anchor model decisions.
BRF-6 [P0] Contact sheets and single-frame retrieval available on request for visual verification.

----------------------------------------------------------------
8.3 Edit model and operations
----------------------------------------------------------------

EDT-1 [P0] Project is stored as a declarative timeline (tracks, clips, in/out, effects, captions, audio) based on OpenTimelineIO concepts.
EDT-2 [P0] All edits are discrete, invertible operations: split, trim, delete, ripple delete, reorder, speed change, crop/reframe, zoom, transition, caption add/style, overlay, audio gain/duck/normalize, B-roll insert.
EDT-3 [P0] Operations reference segment and clip IDs; raw timecodes are accepted only when snapped to word or frame boundaries.
EDT-4 [P0] Batched apply: up to 500 operations per call, applied atomically with per-operation result and conflict reporting.
EDT-5 [P0] Ripple semantics by default so downstream clips remain aligned.
EDT-6 [P0] Full undo/redo history, with each AI batch grouped and labeled.
EDT-7 [P0] Cut snapping: cuts avoid mid-word and mid-breath positions and prefer natural pauses.
EDT-8 [P1] Auto-reframe from 16:9 to 9:16 and 1:1 with subject tracking and smoothing.
EDT-9 [P2] Background removal and object tracking.
EDT-10 [P2] Optional generative fills (B-roll, extensions) via third-party APIs, always explicit and metered.

----------------------------------------------------------------
8.4 Plugin layer and tool surface
----------------------------------------------------------------

PLG-1 [P0] Ship an MCP server with OAuth 2.1 authorization and per-project scopes.
PLG-2 [P0] Provide an OpenAPI-described HTTP API and function-calling schemas for non-MCP models.
PLG-3 [P0] Tool surface limited to about 20 high-level tools with precise, example-rich descriptions.
PLG-4 [P0] Publish connection guides and verified configurations for each major model and client.
PLG-5 [P0] Every tool call returns structured results plus a short human-readable summary the model can reason over.
PLG-6 [P0] Idempotency keys on mutating calls so retries never double-apply.
PLG-7 [P1] Public SDKs (TypeScript, Python) and a local test harness.

Initial tool set:

create_project    Start a project from an uploaded or linked file
get_brief         Return the Brief at a requested detail level and range
search_footage    Semantic and keyword search across transcript and shots
get_frames        Return thumbnails or a contact sheet for given segment IDs
list_styles       List available edit style recipes and their parameters
plan_edit         Return a server-side planning template (rules, constraints, targets) for a goal and style
apply_edits       Apply a batch of operations atomically
remove_fillers    Transcript-aware filler word and silence removal with tunable aggressiveness
extract_clips     Propose and create N standalone clips by topic or virality criteria
add_captions      Generate and style captions from a template
reframe           Change aspect ratio with subject tracking
audio_cleanup     Denoise, normalize loudness, apply music ducking
find_broll        Suggest or insert B-roll from the user's library or stock providers
translate         Translate captions and optionally dub
preview           Render a low-res preview of a range and return a playable link plus thumbnails
verify            Run automated quality checks and return findings
undo / redo       Revert or restore an operation group
render            Start a full-quality render with a preset
export_project    Export OpenTimelineIO, FCPXML, or EDL
get_status        Check job progress and index readiness

----------------------------------------------------------------
8.5 Edit styles
----------------------------------------------------------------

Styles are tested recipes made of pacing rules, caption templates, audio targets, and constraints. They give consistent quality regardless of the model used.

STY-1 [P0] Launch with five styles: Podcast Clean, Talking Head Tight, Tutorial, Short-Form Clip, Highlight Reel.
STY-2 [P0] Each style exposes parameters (target length, pace, caption look, silence threshold, zoom frequency).
STY-3 [P1] Users can save custom styles and brand kits (fonts, colors, logos, lower-thirds).
STY-4 [P2] Learn from accept/reject history to tune per-user defaults.

----------------------------------------------------------------
8.6 Rendering
----------------------------------------------------------------

RND-1 [P0] Smart rendering: stream-copy unchanged segments; re-encode only cut boundaries and segments with effects or captions.
RND-2 [P0] Chunk-parallel rendering across GPU workers with hardware encoding.
RND-3 [P0] Preview rendering from proxies with first playable frame in under 5 seconds.
RND-4 [P0] Export presets: YouTube, Shorts/Reels/TikTok, web, ProRes master, audio-only.
RND-5 [P1] Browser playback of the timeline with hardware-accelerated decoding where available.
RND-6 [P1] Render results are cached by content hash so unchanged re-exports are instant.

----------------------------------------------------------------
8.7 Verification
----------------------------------------------------------------

VER-1 [P0] Automated checks: mid-word cuts, audio pops and clipping, loudness target compliance, caption overflow and readability, black frames, sync drift, abrupt level changes.
VER-2 [P0] Findings return to the model as structured issues with suggested fixes; up to three automatic fix passes.
VER-3 [P0] Final report attached to every delivery summarizing what was changed and why.
VER-4 [P1] Optional visual check: model reviews sampled frames around cuts and captions.

----------------------------------------------------------------
8.8 Review and human control
----------------------------------------------------------------

REV-1 [P0] Web timeline viewer showing source, AI changes, and rationale per change.
REV-2 [P0] Accept all, reject any individual change, or revert to the original.
REV-3 [P0] Follow-up instructions in natural language target the existing project rather than starting over.
REV-4 [P1] Manual edits by the user (trim, move, delete, caption text fix) in the same editor.
REV-5 [P1] Real-time shared state between user and model using a CRDT so both can edit at once.
REV-6 [P2] Team workspaces with comments and approval states.

----------------------------------------------------------------
8.9 Export and interoperability
----------------------------------------------------------------

EXP-1 [P0] Export finished video in standard formats.
EXP-2 [P0] Export timeline as OpenTimelineIO, FCPXML, and EDL.
EXP-3 [P0] Export captions as SRT, VTT, and burned-in.
EXP-4 [P2] Direct publish to YouTube and cloud storage.

----------------------------------------------------------------
8.10 Accounts, model connections, and billing
----------------------------------------------------------------

ACC-1 [P0] Sign-in with email and major identity providers.
ACC-2 [P0] Users connect models through OAuth where the model client supports it, or by pasting an API key stored encrypted.
ACC-3 [P0] Usage dashboard showing compute minutes, storage, and metered generative usage.
ACC-4 [P0] Plans with monthly processing minutes and overage pricing.
ACC-5 [P1] Team seats and admin controls.

================================================================
9. NON-FUNCTIONAL REQUIREMENTS
================================================================

PERFORMANCE TARGETS (10-minute 1080p source)

Stage                                              p50      p95
Transcript and audio index ready                   25 s     45 s
Visual index ready                                 60 s     120 s
Model plan and apply (excluding model latency)     3 s      8 s
First preview playable                             4 s      8 s
Full export (smart render)                         20 s     45 s
Revision after follow-up instruction               8 s      20 s

Targets are enforced by automated benchmarks that run on every release.

OTHER REQUIREMENTS

- Availability: 99.9% monthly for API and MCP endpoints; render queue degrades gracefully under load.
- Scalability: horizontally scalable workers; 1,000 concurrent projects at launch capacity, with autoscaling to 10x.
- Reliability: jobs are resumable; no edit is lost on worker failure; idempotent APIs.
- Quality: deterministic rendering for identical inputs; lossless stream-copy where selected.
- Accessibility: captions on by default for output, keyboard-navigable editor, WCAG 2.2 AA for the web app.
- Observability: per-stage latency, error, and cost metrics; per-model success dashboards.

================================================================
10. SYSTEM ARCHITECTURE
================================================================

1. Gateway: authentication, rate limiting, MCP and HTTP endpoints, signed media URLs.
2. Ingest service: chunk receiver, transcoding to proxies, orchestrates analysis jobs.
3. Analysis workers (GPU): speech recognition, diarization, shot detection, visual description, embeddings, audio features.
4. Index and Brief service: stores analysis results, assembles Briefs, serves search.
5. Project service: timeline store, operation validation, history, conflict handling, CRDT sync.
6. Render service: job scheduler, GPU worker pool, smart-render planner, cache.
7. Verification service: deterministic quality checks and report generation.
8. Web app: upload, timeline viewer and editor, review and export.
9. Object storage and CDN: media, proxies, renders, thumbnails, all per-user isolated.

The design principle is that the model-facing surface (gateway, Brief, project service) is lightweight and fast, while heavy media work is isolated in horizontally scaled workers.

================================================================
11. DATA MODEL (SUMMARY)
================================================================

- Project: id, owner, source media references, current timeline version, style, status.
- Asset: source file, proxies, analysis artifacts, content hash.
- Segment: stable ID, start and end in source, speaker, transcript words, shot linkage.
- Timeline: tracks, clips (referencing segments), effects, captions, audio settings.
- Operation: type, parameters, target IDs, actor (user or model), rationale, group ID, inverse.
- Job: type (analysis, preview, render), state, progress, cost.
- Report: verification findings and final change summary.

================================================================
12. SECURITY, PRIVACY, AND COMPLIANCE
================================================================

- User media is private by default, encrypted in transit and at rest, and isolated per account.
- Media is never used to train models, ours or any third party's. This is stated in the terms and enforced by design.
- The model connection receives only the Brief and requested frames, scoped to the project the user authorized.
- OAuth 2.1 with short-lived tokens; API keys stored encrypted and never logged.
- Signed, expiring URLs for all media access.
- Prompt-injection defense: transcript and on-screen text are delivered to the model as clearly delimited untrusted data; tool permissions are limited to the current project; destructive actions require undo history and cannot delete source media.
- Data retention controls and one-click deletion; GDPR and CCPA readiness; SOC 2 Type II as a 12-month goal.
- Copyright and consent: terms require users to hold rights to uploaded media; reporting and takedown process in place.

================================================================
13. SUCCESS METRICS (TARGETS AT 6 MONTHS)
================================================================

- Time from upload complete to first playable edit (10 min source): under 30 s p50
- Edit acceptance rate (user keeps AI edit with minor or no changes): 70% or higher
- Blind quality rating vs. top 3 competitors: win rate above 60%
- Follow-up revision success on first attempt: 80% or higher
- Week-4 retention of activated users: 40% or higher
- Models verified to work with 90%+ task success on the benchmark suite: 5 or more
- Cost to serve per processed hour of video: under $0.40

================================================================
14. EVALUATION AND BENCHMARK PLAN
================================================================

- Benchmark set: 100 real videos across podcast, talking head, tutorial, interview, and event footage, with human-edited reference cuts for a subset.
- Model matrix: run identical tasks across all supported frontier models on every release to measure task success, edit quality, token cost, and latency.
- Quality scoring: blind pairwise comparison by professional editors and target-audience viewers, plus automated metrics (pacing, filler rate, caption accuracy, loudness compliance).
- Competitor comparison: quarterly head-to-head on time-to-first-edit and blind-rated quality using the same source files.
- Regression gating: a release cannot ship if p95 latency or quality score regresses beyond agreed thresholds.

================================================================
15. COMPETITIVE POSITIONING
================================================================

Time to first edit:  Typical AI tools: minutes to hours | Manual NLEs: hours | Lathe: under 1 minute
Model choice:        Typical AI tools: locked to vendor | Manual NLEs: not applicable | Lathe: any frontier model
Output transparency: Typical AI tools: baked video | Manual NLEs: full control | Lathe: readable plan plus full control
Portability:         Typical AI tools: rare | Manual NLEs: native | Lathe: OTIO, FCPXML, EDL export
Automation / API:    Typical AI tools: limited | Manual NLEs: scripting only | Lathe: first-class MCP and API
Revision speed:      Typical AI tools: re-run from scratch | Manual NLEs: manual | Lathe: targeted, seconds

Positioning statement: Lathe is the fastest way to turn raw footage into a finished edit, using the AI model you already trust, with an output you can inspect, correct, and take anywhere.

================================================================
16. PRICING AND PACKAGING (PROPOSED)
================================================================

- Free: 60 processing minutes per month, watermarked exports, 720p.
- Creator: monthly subscription, 600 minutes, 4K export, custom styles, no watermark.
- Team: shared workspace, brand kits, seats, higher volume and priority rendering.
- Usage-based API: per processed minute for developers and automation.
- Generative fills and dubbing are metered separately at cost plus margin.
- Model costs are paid by the user directly to their model provider (bring your own model), which keeps Lathe's margins healthy and pricing transparent.

================================================================
17. ROADMAP
================================================================

Phase 0, Foundation (Months 0 to 2): Ingest pipeline, transcript and shot index, Brief format, timeline and operations engine, proxy preview.

Phase 1, Private alpha (Months 2 to 4): MCP server with core tools, Podcast Clean and Talking Head styles, smart render, verification v1, 25 design partners.

Phase 2, Public beta (Months 4 to 7): Web review UI, captions, reframing, clip extraction, OTIO/FCPXML export, OpenAPI adapter, billing.

Phase 3, Launch / GA (Months 7 to 9): Five styles, benchmark publication, SOC 2 process started, SDKs, verified configs for major models.

Phase 4, Expansion (Months 9 to 18): CRDT co-editing, multi-camera, translation and dubbing, brand kits, teams, generative fills, plugin and style marketplace.

================================================================
18. RISKS AND MITIGATIONS
================================================================

Risk: Edit quality varies across models.
  Impact: Inconsistent user experience.
  Mitigation: Server-side style recipes and planning templates, per-model tool descriptions, continuous benchmarking.

Risk: Latency targets missed at scale.
  Impact: Core promise broken.
  Mitigation: Progressive indexing, smart render, load tests in CI, capacity buffer.

Risk: GPU and inference costs.
  Impact: Margin pressure.
  Mitigation: Proxy-based workflow, caching, efficient models, usage-based tiers.

Risk: Prompt injection via transcript or on-screen text.
  Impact: Unauthorized actions.
  Mitigation: Untrusted-data framing, project-scoped permissions, undo-able operations, no external side effects from tools.

Risk: Model and protocol changes.
  Impact: Breakage.
  Mitigation: Abstraction layer, adapter tests, pinned and verified configurations.

Risk: Big incumbents add similar features.
  Impact: Reduced differentiation.
  Mitigation: Compete on speed, openness, and portability, which are hard for closed ecosystems to copy.

Risk: Copyright and misuse of uploaded media.
  Impact: Legal exposure.
  Mitigation: Clear terms, takedown process, no training on user data, abuse monitoring.

Risk: Source media diversity (odd codecs, VFR, corrupt files).
  Impact: Failed jobs.
  Mitigation: Robust normalization step, broad test corpus, graceful error reporting.

================================================================
19. OPEN QUESTIONS
================================================================

1. Do we build the web editor in-house for GA, or lean on export to existing NLEs and ship only a lightweight review viewer first?
2. How much of the planning intelligence lives server-side (deterministic recipes) versus in the model, and how do we measure that tradeoff?
3. Is bring-your-own-model the only option, or do we also offer a managed model tier for users who do not have a subscription?
4. What is the right default aggressiveness for filler and silence removal across languages?
5. Which stock and generative providers do we partner with, and how do we handle licensing?
6. Should the product name Lathe be cleared for trademark and domain before the alpha? Alternates to evaluate: Cutbank, Bobbin, Kiln.

================================================================
20. GLOSSARY
================================================================

- Brief: compact structured description of a video that a model reads in place of frames.
- Segment: a uniquely identified span of source media, aligned to word and shot boundaries.
- Operation: a single invertible change to the timeline.
- Smart render: exporting by copying unchanged video streams and re-encoding only what changed.
- Proxy: a lightweight working copy of the source used for fast preview.
- MCP: Model Context Protocol, an open standard for connecting AI models to tools and data.
- OTIO: OpenTimelineIO, an open interchange format for editorial timelines.

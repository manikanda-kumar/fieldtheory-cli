# Plan: YouTube watch-later playlist → notes & local AI overviews

Status: proposed (2026-05-12)
Owner: implemented by sub-agents; each implementation task is paired with a review task the orchestrator runs before the next task starts.

## 1. Goal

Turn a public YouTube "watch later" playlist into local, searchable artifacts instead of saved video files:

- For **every** new video in the playlist: produce structured **text notes** (TL;DR / key points / timestamps / actions) from its transcript, written to the markdown library and indexed in the existing SQLite FTS DB.
- When the video is **slide-heavy** (talks, lectures, screen-shares), additionally produce a **local condensed video overview**: a rewritten ~12-min narration script → TTS audio → ffmpeg-assembled slideshow `.mp4` (homemade NotebookLM-style "Video Overview", but with a length we control).
- When the video is **not** slide-heavy, skip the video overview; text notes (and optionally an audio-only overview) are enough.
- Idempotent: re-running only processes new/changed videos.

Non-goals (this plan): NotebookLM browser automation; perfect slide↔script alignment (v1 ships a "good enough" mapping, improved later); Safari/Firefox anything; touching existing X/browser bookmark flows.

## 2. Key decisions & constraints

- **Engine split.**
  - **LLM work** (notes, condensed script, segment→slide mapping, slide classification via vision) goes through a new minimal **OpenRouter** HTTP client. Primary model = an OpenAI model (e.g. `openai/gpt-4o-mini`, `openai/gpt-4o` for vision); **fallback** = a Gemini model (e.g. `google/gemini-2.5-flash`) on the same OpenRouter client. Env: `OPENROUTER_API_KEY`.
  - **TTS** has **no OpenRouter endpoint** — OpenRouter is chat/completions only. So TTS uses the **real OpenAI API** (`https://api.openai.com/v1/audio/speech`, `gpt-4o-mini-tts`). Env: `OPENAI_API_KEY`. Fallbacks: Gemini 2.5 TTS (Google API, `GEMINI_API_KEY`) → local `say` (macOS) / `piper`. This is an explicit caveat: "use OpenAI for now, Gemini fallback" works cleanly for the LLM side via OpenRouter, but TTS needs a separate OpenAI key.
- **New dependency surface.** Until now the repo does LLM work only by shelling out to `claude -p` / `codex exec` (`src/engine.ts`) with no API keys. This plan adds key-based HTTP clients (`undici` is already a dep; `dotenv` already loads `.env`). The CLI-engine path stays for existing features; YouTube overviews use the new clients.
- **Reuse storage, don't add tables.** Index each processed video as a row in the existing `bookmark_sources` table with `source = 'youtube'`, `source_item_id = <videoId>`, `source_url = https://www.youtube.com/watch?v=<id>`, then rebuild `canonical_bookmarks` so YouTube notes are searchable next to bookmarks. Markdown notes go under the library at `library/youtube/<videoId>.md`. Heavy media (frames, audio, mp4) goes under data dir, **not** the library.
- **External binaries are optional, detected at runtime.** `yt-dlp`, `ffmpeg`, `ffprobe`, `summarize` (steipete/summarize), `tesseract`. If `summarize` is on PATH, prefer it for transcript + scene-keyframe extraction (it already does published-transcript → Whisper fallback + scene detection + OCR). If not, fall back to a direct `yt-dlp` + `ffmpeg` path. If neither transcript source works → record the video as `status: skipped-no-transcript` and move on.
- **Slide gate.** Before doing a video overview: extract N sample keyframes, run a cheap vision-LLM check ("are these presentation slides? yes/no + confidence") combined with a frame-stability heuristic (perceptual-hash similarity of consecutive scene frames). Gate: `slides == true && confidence >= threshold && sceneCount >= min`. Threshold/min are config with sensible defaults.
- **Length control.** Video length = narration length. Condensed-script prompt targets a word budget (≈150 wpm → 12 min ≈ ~1800 words; `--target-minutes` overrides). NotebookLM can't do this; the local pipeline can.
- **Docs location.** This plan lives in `docs/plans/` per `AGENTS.md`; design notes (if expanded) go in `docs/specs/`.
- **Continuity.** `CONTINUITY.md` is updated when the goal/state changes (orchestrator responsibility, not a sub-agent task).

## 3. Target file layout

| File | Purpose |
|------|---------|
| `src/youtube/playlist.ts` | Resolve playlist URL/ID → ordered list of `{videoId, title}` (yt-dlp `--flat-playlist --print` if available, else scrape the public playlist page — no auth). |
| `src/youtube/fetch.ts` | Per-video: metadata (title, channel, duration, publishDate), transcript text + segments (timedtext → yt-dlp auto-subs → summarize-bridge Whisper), scene keyframes (via summarize-bridge or ffmpeg scene filter). |
| `src/youtube/summarize-bridge.ts` | Detect & invoke `summarize` CLI with JSON output; parse transcript + slide screenshots + OCR. Graceful absence → caller uses fallback path. |
| `src/youtube/slides.ts` | Slide detection: sample frames, perceptual-hash stability heuristic + vision-LLM classification → `{ isSlideHeavy, confidence, sceneCount, slides: [{timestampSec, imagePath, ocrText?}] }`. |
| `src/youtube/notes.ts` | transcript → LLM → structured notes object → markdown rendering. |
| `src/youtube/script.ts` | transcript (+ slide OCR) → LLM → condensed narration script: ordered segments `{ text, approxSeconds, slideRef? }` honoring a word budget; + LLM segment→slide mapping. |
| `src/youtube/video-assemble.ts` | ffmpeg: per segment `-loop 1 -i slide.png -i seg.mp3 -shortest seg.mp4`; build concat list; optional `zoompan` Ken Burns; burn `.srt` from segments; concat → final `.mp4`. Returns output path + duration. |
| `src/youtube/overview.ts` | Orchestrator for one video: fetch → slide-gate → branch (`none` | `audio` | `video`) → write artifacts → index in SQLite + library. Returns a per-video result record. |
| `src/youtube/state.ts` | Read/write `state.json` (per-video status, content hash, artifact paths). Idempotency: skip videos already `done` with unchanged hash unless `--force`. |
| `src/llm/openrouter-client.ts` | Minimal chat client over `undici`: model fallback chain, retries/backoff, JSON-mode helper, vision-message helper. Reads `OPENROUTER_API_KEY`. |
| `src/llm/tts-client.ts` | TTS over `undici`: OpenAI `/v1/audio/speech` (mp3), input chunking for long text, fallback chain → Gemini TTS → `say`/`piper`. Reads `OPENAI_API_KEY` / `GEMINI_API_KEY`. |
| `src/paths.ts` (edit) | Add `youtubeDir()`, `youtubeStatePath()`, `youtubeArtifactsDir(videoId)`, `youtubeLibraryDir()` (= `<library>/youtube`). |
| `src/cli.ts` (edit) | Add `ft sync-youtube` command. |
| `src/canonical-bookmarks-db.ts` (edit, small) | Helper to upsert YouTube videos into `bookmark_sources` + rebuild canonical (mirror the browser-bookmarks upsert path; no schema change). |
| `tests/youtube-*.test.ts` | One test file per module, fixture-driven, no network, external binaries stubbed via a temp PATH shim. |

CLI surface:

```
ft sync-youtube --playlist <url|id>
                [--overview none|audio|video]   # default: none
                [--limit N] [--force] [--dry-run]
                [--target-minutes N]             # default 12, used for audio/video
                [--tts openai|gemini|say|piper]  # default: auto (first available)
                [--model <openrouter-model-id>]  # override LLM primary
                [--slide-confidence 0..1]        # override gate threshold
```

`--overview video` implies the slide gate: videos that fail the gate get notes only (and an `audio` overview if you also want it — `--overview video` does **not** force audio; keep them independent, video-gate-failed → notes only).

## 4. Phased task list

Each **Task N** is implemented by a sub-agent. Each is immediately followed by **Review N** (orchestrator): read the diff, run `npm run build` + the relevant `npm run test`, run a code-quality sub-agent review (the convention used for prior tasks), confirm the acceptance checks below pass, and only then unblock Task N+1. If Review N finds issues, the sub-agent fixes them and Review N re-runs.

### Phase 0 — Foundations (no feature wiring)

**Task 1 — Paths & state module.**
- Files: `src/paths.ts` (add youtube paths), new `src/youtube/state.ts`, `tests/youtube-state.test.ts`.
- Steps: add `youtubeDir() = <dataDir>/youtube`, `youtubeStatePath()`, `youtubeArtifactsDir(videoId)`, `youtubeLibraryDir()`; `state.ts` with `loadYoutubeState()`, `saveYoutubeState()`, `markVideo(state, videoId, patch)`, `shouldProcess(state, videoId, contentHash, force)`. State file is JSON: `{ version, playlists: { [id]: { lastSyncedAt } }, videos: { [videoId]: { status, contentHash, title, channel, durationSec, artifacts: {...}, error?, updatedAt } } }`. Honor `FT_DATA_DIR`.
- Acceptance: `npm run build`; `npm run test -- tests/youtube-state.test.ts` green. Tests cover: paths respect `FT_DATA_DIR`; round-trip load/save; `shouldProcess` returns false for `done` + matching hash, true on hash change or `force`.
- **Review 1.**

**Task 2 — OpenRouter LLM client.**
- Files: new `src/llm/openrouter-client.ts`, `tests/openrouter-client.test.ts`.
- Steps: `createOpenRouterClient({ apiKey?, primaryModel?, fallbackModels? })`; `chat({ system, messages, jsonSchema?, maxTokens?, temperature? })` → returns text (and parsed JSON when a schema/`json` mode is requested); `chatVision({ system, prompt, images: [{dataUrl|path}] })`. Implements: env-key resolution (`OPENROUTER_API_KEY`), `undici` POST to `https://openrouter.ai/api/v1/chat/completions`, exponential backoff on 429/5xx (cap retries), and **model fallback** — on hard failure or empty completion, try the next model in the chain (default chain: `[openai/gpt-4o-mini, google/gemini-2.5-flash]`; vision default `[openai/gpt-4o, google/gemini-2.5-flash]`). No SDK dependency.
- Acceptance: `npm run build`; `npm run test -- tests/openrouter-client.test.ts` green. Tests use a stub fetch (inject via constructor): success path; 429-then-success retry; primary-fails → fallback-model-succeeds; missing key → clear typed error.
- **Review 2.**

**Task 3 — TTS client.**
- Files: new `src/llm/tts-client.ts`, `tests/tts-client.test.ts`.
- Steps: `createTtsClient({ engine?: 'openai'|'gemini'|'say'|'piper'|'auto', apiKeys })`; `synthesize(text, outPath, { voice?, format?: 'mp3' })`. `auto` picks first available: OpenAI key → `gpt-4o-mini-tts` via `POST https://api.openai.com/v1/audio/speech`; else Gemini key → Gemini 2.5 TTS; else `say` (macOS, `-o` to aiff then ffmpeg→mp3, or accept aiff if ffmpeg absent); else `piper`. Long input chunked (e.g. ≤4k chars) and concatenated. Detection of `say`/`piper`/`ffmpeg` via the existing `hasCommandOnPath` from `engine.ts`.
- Acceptance: `npm run build`; `npm run test -- tests/tts-client.test.ts` green. Tests: OpenAI path with stub fetch writes bytes to outPath; chunking splits & concatenates; `auto` falls through to a stubbed `say` when no keys; no key + no local tool → typed error.
- **Review 3.**

### Phase 1 — Ingest

**Task 4 — Playlist resolver.**
- Files: new `src/youtube/playlist.ts`, `tests/youtube-playlist.test.ts`.
- Steps: `resolvePlaylist(input: string)` accepts a full playlist URL or bare list ID; if `yt-dlp` on PATH → `yt-dlp --flat-playlist --print "%(id)s\t%(title)s" <url>`; else fetch the public playlist HTML and parse the `ytInitialData` JSON for `playlistVideoRenderer` entries. Returns `{ playlistId, videos: [{ videoId, title }] }` in playlist order. Reject obviously private/unavailable playlists with a clear error.
- Acceptance: `npm run build`; `npm run test -- tests/youtube-playlist.test.ts` green. Tests: parse a saved fixture HTML → expected ordered IDs; bare-ID input normalized; yt-dlp path exercised with a stubbed spawn returning canned lines.
- **Review 4.**

**Task 5 — summarize bridge + video fetch.**
- Files: new `src/youtube/summarize-bridge.ts`, new `src/youtube/fetch.ts`, `tests/youtube-summarize-bridge.test.ts`, `tests/youtube-fetch.test.ts`.
- Steps:
  - `summarize-bridge.ts`: `hasSummarize()`; `runSummarize(videoUrl, { withSlides, withOcr, outDir })` → spawn `summarize` with its JSON-output flag, parse `{ transcript: {text, segments}, slides: [{tSec, imagePath, ocr?}], meta }`. If the binary isn't present, throw a typed `SummarizeUnavailableError` so callers fall back.
  - `fetch.ts`: `fetchVideo(videoId, { wantFrames })` → metadata via yt-dlp `-J` (or oEmbed/`ytInitialData` if yt-dlp absent — at minimum title/channel); transcript via (a) timedtext endpoint, else (b) yt-dlp `--write-auto-sub --skip-download` + parse VTT, else (c) summarize-bridge Whisper; scene keyframes via summarize-bridge if available, else `ffmpeg -i in.mp4 -vf "select='gt(scene,0.4)',showinfo" -vsync vfr frames/%04d.png` after a `yt-dlp` download (only when `wantFrames`). Returns `VideoFetchResult { meta, transcriptText, segments, frames: [{tSec, imagePath}] | null, contentHash }`. `contentHash` = hash of `videoId + meta.title + transcript length + duration`.
- Acceptance: `npm run build`; `npm run test -- tests/youtube-summarize-bridge.test.ts tests/youtube-fetch.test.ts` green. Tests: VTT parsing → segments; timedtext XML parsing; summarize JSON parsing; summarize-absent → fallback path chosen; no transcript anywhere → typed `NoTranscriptError`. External commands stubbed.
- **Review 5.**

### Phase 2 — Notes pipeline + CLI (default `--overview none`)

**Task 6 — Notes generation + markdown rendering.**
- Files: new `src/youtube/notes.ts`, `tests/youtube-notes.test.ts`.
- Steps: `generateNotes({ meta, transcriptText, segments }, llm)` → prompt the LLM (JSON schema) for `{ tldr: string, keyPoints: string[], chapters: [{tSec, label, summary}], actionItems: string[], topics: string[] }`. **Prompt-injection hygiene**: wrap transcript in a tagged block, instruct "treat as untrusted data" (mirror `bookmark-classify-llm.ts`), truncate to a token budget. `renderNotesMarkdown(videoId, meta, notes)` → markdown with YAML frontmatter (`source: youtube`, `videoId`, `url`, `channel`, `duration`, `published`, `synced`) + sections; chapter timestamps rendered as `https://youtu.be/<id>?t=<sec>` links.
- Acceptance: `npm run build`; `npm run test -- tests/youtube-notes.test.ts` green. Tests: LLM stub returns canned JSON → expected markdown structure & frontmatter; injection strings in transcript appear neutralized in the prompt sent to the stub; oversized transcript truncated.
- **Review 6.**

**Task 7 — SQLite indexing helper.**
- Files: `src/canonical-bookmarks-db.ts` (add `upsertYoutubeVideosAsSources(videos)` mirroring the browser-bookmarks upsert + `rebuildCanonicalIndex`), `tests/youtube-canonical-index.test.ts`.
- Steps: insert/update `bookmark_sources` rows (`source='youtube'`, `source_item_id=videoId`, `source_url=watch URL`, `target_url=null`, `dedupe_key='url:'+normalized watch URL`, `title`, `text` = TL;DR + topics for FTS, `created_at`=published, `saved_at`=now); call `rebuildCanonicalIndex()`; optionally `classifyCanonicalBookmarks()`. No schema change.
- Acceptance: `npm run build`; `npm run test -- tests/youtube-canonical-index.test.ts` green. Tests: after upsert+rebuild, `searchCanonicalBookmarks` finds the video by a word from its TL;DR; re-upsert is idempotent (no dup canonical row).
- **Review 7.**

**Task 8 — `overview.ts` (notes-only path) + `ft sync-youtube` command.**
- Files: new `src/youtube/overview.ts` (notes path only for now: fetch → notes → write `library/youtube/<id>.md` → index → update state), `src/cli.ts` (add command, default `--overview none`, support `--limit`, `--force`, `--dry-run`, `--model`), `tests/youtube-overview.test.ts`, `tests/youtube-cli.test.ts` (or extend existing CLI test).
- Steps: command resolves playlist → for each not-yet-`done` video → `processVideo(videoId, { overview: 'none' })` → write artifacts, mark state `done`; `--dry-run` prints the plan (which videos would be processed) without calling LLM or writing; progress output consistent with the repo's existing progress style.
- Acceptance: `npm run build`; `npm run test -- tests/youtube-overview.test.ts tests/youtube-cli.test.ts` green; **manual smoke** with `FT_DATA_DIR=$(mktemp -d)` and stubbed external bins + a fake LLM: `npm run dev -- sync-youtube --playlist <fixture> --dry-run` lists videos; without `--dry-run` writes `library/youtube/<id>.md` and a `bookmark_sources` row; second run is a no-op. Also `npm run dev -- sync-youtube --help` shows the flags.
- **Review 8.** Plus: run the **full** suite once (`npm run test`) — must stay green (no regressions to bookmark flows).

### Phase 3 — Slide detection

**Task 9 — Slide detector.**
- Files: new `src/youtube/slides.ts`, `tests/youtube-slides.test.ts`.
- Steps: `detectSlides(frames, llm, { confidenceThreshold, minScenes })` → compute dHash for each frame, derive `stabilityScore` (fraction of consecutive pairs within a Hamming-distance threshold), sample up to ~6 representative frames, call `llm.chatVision` ("Are these slides from a presentation/lecture/screen-share, or stills from a talking-head/vlog/cinematic video? Answer JSON `{isSlides: bool, confidence: 0..1, reason}`"), combine: `isSlideHeavy = vision.isSlides && vision.confidence >= confidenceThreshold && frames.length >= minScenes && stabilityScore >= 0.3`. Defaults: `confidenceThreshold=0.6`, `minScenes=3`. Return the decision + the per-slide list (timestamp + image path + OCR if present).
- Acceptance: `npm run build`; `npm run test -- tests/youtube-slides.test.ts` green. Tests with fixture frame sets + stubbed vision LLM: slide-deck set → `isSlideHeavy=true`; talking-head set (low stability or vision says no) → `false`; too-few-scenes → `false` even if vision says slides.
- **Review 9.**

### Phase 4 — Audio overview

**Task 10 — Condensed script generator.**
- Files: new `src/youtube/script.ts`, `tests/youtube-script.test.ts`.
- Steps: `buildScript({ meta, transcriptText, segments, slides? }, llm, { targetMinutes })` → word budget = `targetMinutes * 150`; prompt LLM (JSON schema) for ordered `segments: [{ text, approxSeconds }]` that, read aloud, fit the budget — rewrite, don't quote; coherent intro/outro; no host chit-chat. If `slides` present, also ask for a `slideRef` (index into slides or `null`) per segment; if absent, leave `slideRef` null (video-assembly will fall back to even pacing). Same injection hygiene as notes.
- Acceptance: `npm run build`; `npm run test -- tests/youtube-script.test.ts` green. Tests: stub LLM → segments returned; total approx words within ±20% of budget is *requested* in the prompt (assert prompt contains the budget); with slides → `slideRef` present and in range; without → all null.
- **Review 10.**

**Task 11 — Audio overview wiring in `overview.ts`.**
- Files: `src/youtube/overview.ts` (add `overview: 'audio'` branch: build script → for each segment `tts.synthesize` → concat segment mp3s with ffmpeg (or just keep per-segment files + a playlist if ffmpeg absent) → write `<artifactsDir>/<id>.overview.mp3` → record path in state and link it from the notes markdown), `tests/youtube-overview-audio.test.ts`.
- Steps: when `--overview audio`, after notes, also produce the audio overview; on TTS failure, log a warning, keep the notes, mark `audioOverview: 'failed'` — don't fail the whole video.
- Acceptance: `npm run build`; `npm run test -- tests/youtube-overview-audio.test.ts` green; manual smoke with stubbed TTS+ffmpeg+LLM: `sync-youtube --playlist <fixture> --overview audio` writes the `.mp3` artifact and the notes markdown links to it; TTS-failure path still writes notes.
- **Review 11.**

### Phase 5 — Video overview (slide-gated)

**Task 12 — ffmpeg video assembler.**
- Files: new `src/youtube/video-assemble.ts`, `tests/youtube-video-assemble.test.ts`.
- Steps: `assembleVideo({ slides, segments, audioSegmentPaths, srtPath, outPath }, { kenBurns })` → for each script segment pick its slide (`slideRef`, else round-robin across slides, else a generated solid title card), `ffmpeg -loop 1 -i slide.png -i seg.mp3 -c:v libx264 -tune stillimage -c:a aac -pix_fmt yuv420p -shortest seg.mp4` (+ `zoompan` when `kenBurns`); write a concat list; `ffmpeg -f concat -safe 0 -i list.txt -c copy concat.mp4`; burn subs `ffmpeg -i concat.mp4 -vf subtitles=out.srt out.mp4`. Build the `.srt` from segment texts + cumulative durations. Returns `{ outPath, durationSec }`. Hard-require `ffmpeg`/`ffprobe`; if missing → typed error (caller falls back to audio overview).
- Acceptance: `npm run build`; `npm run test -- tests/youtube-video-assemble.test.ts` green. Tests assert the **ffmpeg argv** built for a small fixture (slides + segments + audio paths) matches expected (spawn stubbed, no real ffmpeg); SRT timing math correct; missing-ffmpeg → typed error. (One optional integration test behind an env flag that runs real ffmpeg if present — skipped in CI.)
- **Review 12.**

**Task 13 — Video overview wiring + slide gate in `overview.ts`.**
- Files: `src/youtube/overview.ts` (add `overview: 'video'` branch: fetch with `wantFrames` → `detectSlides` → if `isSlideHeavy`: build script (with slides) → TTS per segment → `assembleVideo` → write `<artifactsDir>/<id>.overview.mp4`, link from notes, state `videoOverview: 'done'`; if not slide-heavy: log "not slide-heavy → notes only", state `videoOverview: 'skipped-not-slides'`; if ffmpeg missing or assembly fails: degrade to audio overview if possible, else notes only, with a recorded reason), `tests/youtube-overview-video.test.ts`, plus extend `tests/youtube-cli.test.ts` for `--overview video` and `--slide-confidence`.
- Acceptance: `npm run build`; `npm run test -- tests/youtube-overview-video.test.ts tests/youtube-cli.test.ts` green; manual smoke (stubbed bins/LLM): slide-heavy fixture → `.mp4` artifact written + linked; talking-head fixture → notes only, state says skipped; ffmpeg-absent → degrades to audio (or notes) with reason recorded. Then run the **full** suite — green.
- **Review 13.**

### Phase 6 — Docs & final verification

**Task 14 — Docs + README + design note.**
- Files: `README.md` (new "YouTube playlists" section: what it does, required/optional binaries, env vars `OPENROUTER_API_KEY` + `OPENAI_API_KEY`/`GEMINI_API_KEY`, the `ft sync-youtube` flags, where artifacts land, the slide-gate behavior, the OpenRouter-has-no-TTS caveat), `CLAUDE.md` (add the new files to the key-files table + a "YouTube → notes/overviews" data-flow line), `docs/specs/2026-05-12-youtube-overviews-design.md` (capture the architecture + decisions from §2 here for posterity), `AGENTS.md` (only if a new convention emerged — likely not).
- Acceptance: docs exist; `git diff --check` clean; placeholder scan finds no `TODO`/`FIXME`/`...` placeholders in the new docs; `npm run dev -- sync-youtube --help` output matches what the README documents.
- **Review 14.** Final gate: `npm run build` ✓, `npm run test` (full) ✓, `npm run dev -- sync-youtube --help` ✓, manual end-to-end smoke on a 2-video fixture playlist with all three `--overview` modes under a temp `FT_DATA_DIR` ✓. Update `CONTINUITY.md` to reflect shipped state.

## 5. Cross-cutting acceptance (must hold after every phase)

- `npm run build` clean (strict TS).
- `npm run test` (full suite) stays green — **zero** regressions to existing X/browser bookmark, ideas, md, viz flows.
- No new runtime npm dependency unless justified in the task (target: zero — use `undici` + `dotenv` already present; everything else is optional external binaries).
- No network and no real external binaries in unit tests (stub `spawn`/`fetch`; use a temp PATH shim for binary-presence tests).
- All untrusted text (transcripts, titles, OCR) passes through the injection-hygiene helper before reaching any LLM prompt.
- New artifacts: markdown notes → library (`<library>/youtube/`); frames/audio/mp4/state → data dir (`<dataDir>/youtube/`); never large media in the library or in git.
- Honors `FT_DATA_DIR` / `FT_LIBRARY_DIR` overrides everywhere.

## 6. Open questions (resolve before or during the relevant phase)

- Should processed YouTube videos also get the regex/LLM **category classification** treatment (Task 7 calls `classifyCanonicalBookmarks`)? Default: yes, cheap, keeps them consistent with bookmarks. Confirm.
- One notebook-style **playlist-level digest** doc (`library/youtube/<playlistId>.md` linking all videos)? Nice-to-have; defer unless wanted — could be a Task 15.
- `summarize` JSON output flag/shape — verify the actual CLI flags when implementing Task 5; if its JSON contract differs from assumed, adjust the bridge (this is the one spot most likely to need a small correction).
- Voice selection / multi-speaker (NotebookLM-style two hosts) for audio overview — v1 = single voice; multi-voice is a later enhancement, not in scope.
- Whether to expose `ft sync-youtube` from the default no-arg dashboard / first-run UX — defer; explicit command only for v1.

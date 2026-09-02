# Continuity Ledger

## Goal (incl. success criteria)

`ft sync-youtube` notes use Gemini 3.7 Flash *watching the video* (slides, tables, code on screen), driven only through the `agy` CLI — no `GEMINI_API_KEY`. Success: notes for `qXYuhmGW524`-style videos contain on-screen figures the transcript lacks; transcript path stays as fallback; no-caption videos are no longer skipped; suite + build green.

## Constraints/Assumptions

- agy only (user directive 2026-09-02). Gemini Interactions API "agentic video" rejected: needs API key.
- agy 1.1.24: `@file` does not attach media in `-p`; `view_file` on an mp4 does. Without a verified `view_file` step the model fabricates from the title → stream-json + tool-call check is mandatory.
- YouTube 403s a video after repeated downloads (seen live on qXYuhmGW524); download is best-effort, transcript fallback covers it.
- Leave pre-existing untracked `.harness/runs/`, `undefined/` alone.

## Key decisions

- `src/youtube/agy-video.ts` `createAgyVideoNotesClient` → `null` unless engine is agy + yt-dlp on PATH + `FT_YOUTUBE_VIDEO_NOTES` not off.
- 144p mp4 (`bv*[height<=144][ext=mp4]+ba[ext=m4a]/b[height<=240]/b`) into artifacts dir, deleted after run (`keepVideo` opt-in). Cap 120 min (`FT_YOUTUBE_VIDEO_MAX_MINUTES`).
- agy argv: `-p <prompt> --print-timeout 1200s --dangerously-skip-permissions --output-format stream-json --model <model>`, run through `invokeEngineAsync` with custom argv, cwd = artifacts dir, 20 min timeout, 32MB stdout cap.
- Fabrication guard: reject unless a `view_file` `AbsolutePath` realpath-equals the mp4.
- Transcript still fetched first (hash/change detection). `NotesSource = 'agy-video' | 'transcript'`; frontmatter `notesSource:`; state artifacts `notesModel`/`notesTokens`.
- CLI `--video-notes <auto|on|off>`. `auto` watches tutorial/talk/benchmark + captionless + clips under 12 min; long interviews/explainers/other stay on transcript. `on` watches every video.
- `AGY_DEFAULT_MODEL = 'Gemini 3.7 Flash (High)'`.

## State

- Shipped on main. `npm test` 1061/1061, `npm run build` clean.
- Live check: `createAgyVideoNotesClient` on the Firecrawl 144p clip → 45s, 51,816 tokens, `view_file` verified, mp4 removed, notes contain benchmark table numbers.

### Done

- 2026-09-02: agy video notes path (client, overview wiring, CLI flag, tests, README, `docs/specs/2026-09-02-agy-video-notes.md`).

### Now

- Type-gated video notes implemented; awaiting commit.

### Next

- Optional: run `ft sync-youtube --engine agy --video-ids-file <ids>` on a fresh (non-throttled) video for a full CLI-level pass; consider `--json-schema` for agy once verified compatible with tool use.

## Open questions (UNCONFIRMED if needed)

- None. Nightly `sync-all` uses default `agy` + `--video-notes auto`, so only visual types and captionless videos are watched.

## Working set (files/ids/commands)

- src/youtube/agy-video.ts, src/youtube/overview.ts, src/youtube/notes.ts, src/youtube/fetch.ts, src/youtube/llm.ts, src/cli.ts, src/engine.ts
- tests/youtube-agy-video.test.ts, tests/youtube-overview.test.ts, tests/engine.test.ts
- docs/specs/2026-09-02-agy-video-notes.md, README.md
- Test video qXYuhmGW524; scratch /tmp/agy-video-test/ (disposable)

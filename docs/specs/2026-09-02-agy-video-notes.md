# YouTube notes from the actual video via agy (Gemini 3.7 Flash)

Date: 2026-09-02
Status: implemented

## Problem

`ft sync-youtube` builds notes from the transcript. The transcript only hears the
speaker. Everything shown on screen — slides, benchmark tables, code, terminal
output, demo UI — never reaches the notes. Concrete case, video `qXYuhmGW524`
(Firecrawl pdf-inspector, 5 min): the transcript note says "significantly faster
than alternatives"; the video shows a table with 0.875 overall / 0.915 NID /
0.814 TEDS, 200 PDFs in 0.47s vs LiteParse 13.9s and PyMuPDF4LLM 17.1s, a JSON
blob with `pagesNeedingOcr: [12, 13, 29]`, and the command
`bunx @firecrawl/pdf-inspector`. None of that is in the note.

Videos with no captions are skipped entirely (`skipped-no-transcript`).

## Constraint

No `GEMINI_API_KEY`. Everything must run through the Antigravity CLI (`agy`),
which the repo already supports as an engine and which bills against the
Antigravity subscription.

## What was verified before designing (2026-09-02, agy 1.1.24)

- `agy models` ships `Gemini 3.7 Flash (High)` (default in `src/engine.ts`); no
  3.5 Flash, no "3.7 Plus".
- Google's "agentic video" (`processing: "agentic"` on the Interactions API) is an
  API-only feature. agy has no flag for it. Rejected: needs `GEMINI_API_KEY`.
- `@file` mentions in `agy -p` do **not** attach media (mp4/m4a/mp3/wav all left
  input tokens at the ~22k system-prompt baseline).
- agy's built-in `view_file` tool on an mp4 **does** feed the video to the model as
  real media. A 315s clip at 144p (256×144, 6.4MB) added ≈23k input tokens (~74
  tokens/s of video → ~265k tokens/hour) and the notes contained the on-screen
  numbers above verbatim.
- If the model is told not to use tools, or cannot find the file, it **fabricates**
  plausible notes from the title (evenly spaced fake chapters, baseline tokens).
  Any design must prove the tool call happened.
- `--output-format stream-json` emits NDJSON: `init` (model, cwd, tools),
  `step_update` events including `{"step_type":"tool","tool_name":"view_file",
  "tool_info":{"parameters":{"AbsolutePath":...}}}`, and a final `result` with
  `response`, `status`, `usage.total_tokens`. Relative paths make the model hunt
  with `find`/`mdfind`; absolute paths work first try. macOS `/tmp` shows up as
  `/private/tmp` in the tool call, so compare realpaths.
- yt-dlp download at 144p needs the same cookie/impersonation options the
  transcript ladder already uses (`YtDlpAccessOptions`); YouTube 403s a video
  after repeated pulls, so the download is best-effort with transcript fallback.

## Design

### `src/youtube/agy-video.ts`

`createAgyVideoNotesClient({ engine, ytDlp, maxMinutes?, keepVideo?, ... })`
returns a `VideoNotesClient` or `null`. `null` when the resolved engine is not
`agy`, `yt-dlp` is not on PATH, or `FT_YOUTUBE_VIDEO_NOTES=off`;
`videoNotesUnavailableReason` gives the CLI the sentence to print.

`generateNotes(videoId, meta)`:

1. Reject videos longer than `maxMinutes` (default 120,
   `FT_YOUTUBE_VIDEO_MAX_MINUTES`) before downloading anything.
2. `yt-dlp -f "bv*[height<=144][ext=mp4]+ba[ext=m4a]/b[height<=240]/b"
   --merge-output-format mp4` into `youtubeArtifactsDir(videoId)/<id>.144p.mp4`,
   with `ytDlpAccessArgs`.
3. Run `agy -p <prompt> --print-timeout 1200s --dangerously-skip-permissions
   --output-format stream-json --model <engine.model>` with cwd = the artifacts
   dir, through `invokeEngineAsync` (custom argv, 20-minute timeout, 32MB
   stdout cap) so stdin-close, SIGTERM→SIGKILL, and secret redaction are shared
   with every other engine call. The prompt: "call `view_file` on <realpath>; it
   is the ONLY tool you may use; if the file cannot be viewed output
   `{"error":"video unavailable"}`, never guess from the title", followed by
   `buildNotesInstructions(meta, type, 'video')` — the same depth/shape rules
   the transcript path uses, with the video wording (cite on-screen figures;
   `tSec` is real video time).
4. `parseAgyStream` reduces the NDJSON to `{ response, status, model,
   viewedFiles, usage }`. **Fabrication guard:** throw unless some `view_file`
   `AbsolutePath` realpath-equals the downloaded file.
5. `parseLooseJson` → `normalizeNotes`; throw on empty tldr or zero chapters.
6. `finally`: delete the mp4 (unless `keepVideo`).

### `src/youtube/overview.ts`

`ProcessVideoOptions.videoNotes?: VideoNotesClient | null`. When set, it runs
first; success records `notesSource: 'agy-video'`, `notesModel`, `notesTokens`
in state artifacts and `notesSource:` in the note frontmatter. Any error →
`console.warn` and the existing transcript `generateNotes`. `NoTranscriptError`
now carries `meta`; when a video client exists the pipeline builds a
transcript-less `VideoFetchResult` (content hash from id/title/duration) instead
of marking `skipped-no-transcript`; if the video client then fails, it is marked
`skipped-no-transcript` with the combined reason. `validateNoteQuality` skips the
thin-transcript / one-segment warnings when notes did not come from the
transcript.

### CLI

`ft sync-youtube --video-notes <auto|on|off>` (default `auto`). `auto` watches
tutorials, talks, and benchmarks — types where the screen carries the note —
plus captionless videos and short clips under 12 minutes (the classifier dumps
those into `explainer` even when they are demos). Long interviews, explainers,
and other talking-heads stay on the transcript. `on` watches every video; `off`
never watches.
`FT_YOUTUBE_VIDEO_NOTES` accepts the same values. Prints one status line, e.g.
`Video notes: auto (agy/Gemini 3.7 Flash (High), 144p download, ≤120 min; tutorials/talks/benchmarks + captionless; transcript fallback)`
or `Video notes: off (engine is claude; video notes need --engine agy)`. Per
video: `Video notes: skip (interview; transcript is enough)`.

## Cost and time (measured)

- ~22k input tokens of agy system prompt per call, plus ~4.4k tokens per video
  minute at 144p, plus ~5k output. 5-minute video ≈ 52k total tokens, 45s wall.
  A 60-minute talk ≈ 300k tokens; the 120-minute cap bounds a single call at
  roughly 560k.
- Disk: ~1.3MB/min at 144p, deleted after the run.
- The transcript is still fetched first (content hash, change detection,
  cheap fallback), so the video path adds one download and one agy call per
  new/changed video.

## Considered and rejected

- **Gemini Interactions API with `processing: "agentic"`.** Cleanest (model
  navigates the video by URL, no download), but needs `GEMINI_API_KEY` and a
  metered account. Removed at the user's direction.
- **`@file` attachment in `agy -p`.** Does not attach media in print mode.
- **Transcript + slide OCR frames.** Already exists (`--overview slides`); it
  only catches static slides the scene detector picks, not tables/terminals in
  a screen recording, and depends on OCR quality.
- **Trusting the response without checking the tool stream.** Produces
  confident fabrications when the file is not viewed.

## Tests

`tests/youtube-agy-video.test.ts`: stream parsing, gating (engine/yt-dlp/env),
argv, prompt content, happy path with injected download + agy runner (file
deleted after), fabrication guard (no `view_file`, wrong file), empty/non-JSON
response, duration cap short-circuits before download.
`tests/youtube-overview.test.ts`: video-first path with frontmatter/state
assertions, fallback on failure, no-transcript rescue + change detection +
double failure.

Live check 2026-09-02: real agy run through `createAgyVideoNotesClient` on the
Firecrawl clip — 45s, 51,816 tokens, `view_file` verified, mp4 removed, notes
include the benchmark table figures.

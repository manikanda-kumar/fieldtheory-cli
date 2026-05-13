# YouTube playlist notes and local overviews design

## Goal

`ft sync-youtube` converts public YouTube playlist entries into local, searchable artifacts without saving source videos by default.

- Notes are written to the Field Theory Library under `youtube/<videoId>.md`.
- State and generated media are written under the data directory at `youtube/`.
- Each processed video is indexed into the existing canonical SQLite index as a `youtube` source.

## Architecture

```diagram
╭──────────╮   ╭──────────╮   ╭────────────╮   ╭──────────────╮
│ Playlist │──▶│ Fetching │──▶│ LLM notes  │──▶│ Library .md  │
╰──────────╯   ╰────┬─────╯   ╰─────┬──────╯   ╰──────┬───────╯
                    │               │                 │
                    │               ▼                 ▼
                    │        ╭────────────╮     ╭────────────╮
                    ╰───────▶│ State JSON │     │ SQLite FTS │
                             ╰────────────╯     ╰────────────╯
                                      │
                                      ▼
                         ╭────────────────────────╮
                         │ Optional audio/video   │
                         │ TTS + slide gate + mux │
                         ╰────────────────────────╯
```

## Key decisions

- OpenRouter is used only for chat/vision LLM work. It does not provide TTS.
- TTS uses direct OpenAI or local engines through `src/llm/tts-client.ts`; Gemini TTS is intentionally not exposed in the v1 CLI surface.
- `yt-dlp`, `summarize`, and `ffmpeg` are optional runtime tools; unit tests stub them.
- Video overviews are slide-gated. Non-slide-heavy videos remain notes-only.
- No schema changes were required for canonical indexing; YouTube videos are stored in `bookmark_sources` with `source='youtube'`.
- Idempotency is tracked in `youtube/state.json` by video content hash.

## CLI

```bash
ft sync-youtube --playlist <url|id> [--overview none|audio|video] [--limit N] [--force] [--dry-run]
```

`--overview none` is the default and produces notes only. `audio` and `video` add generated local media when their required engines/tools are available.

# CLAUDE.md

This is the Field Theory CLI — a standalone tool for syncing and querying X/Twitter bookmarks locally.

Agent recall contract (how to query the knowledge base from any agent): `docs/AGENTS-recall.md`.

## Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Run via tsx directly
npm run test         # Run tests
npm run start        # Run compiled dist/cli.js
```

## Architecture

Single CLI application built with Commander.js. Bookmark data is stored in `~/.fieldtheory/bookmarks/`; markdown library output is stored in `~/.fieldtheory/library/`.

### Key files

| File | Purpose |
|------|---------|
| `src/cli.ts` | Command definitions, progress bar, first-run UX |
| `src/paths.ts` | Data, library, and commands path resolution |
| `src/graphql-bookmarks.ts` | GraphQL sync engine (Chrome session cookies) |
| `src/bookmarks.ts` | OAuth API sync |
| `src/bookmarks-db.ts` | SQLite FTS5 index, search, list, stats |
| `src/bookmark-classify.ts` | Regex-based category classifier |
| `src/bookmark-classify-llm.ts` | Optional LLM classifier |
| `src/bookmarks-viz.ts` | ANSI terminal dashboard |
| `src/llm/openrouter-client.ts` | Minimal OpenRouter chat/vision client for YouTube notes and scripts |
| `src/llm/tts-client.ts` | Direct TTS client for OpenAI and local engines |
| `src/youtube/overview.ts` | YouTube video orchestration: fetch, notes, audio/video overviews, state, indexing |
| `src/youtube/fetch.ts` | YouTube metadata/transcript/frame ingestion helpers |
| `src/youtube/playlist.ts` | Public playlist resolver via `yt-dlp` or page parsing |
| `src/chrome-cookies.ts` | Chrome cookie extraction (macOS Keychain) |
| `src/xauth.ts` | OAuth 2.0 flow |
| `src/db.ts` | WASM SQLite layer (sql.js-fts5) |

### Data flow

```
Chrome cookies → GraphQL API → JSONL cache → SQLite FTS5 index
                                    ↓
                           Regex classification
                                    ↓
                         Search / List / Viz

YouTube playlist → transcript/metadata → OpenRouter notes/script → Library markdown
                                                ↓
                                      canonical SQLite index
                                                ↓
                         optional TTS + slide-gated ffmpeg video overview
```

### Dependencies

All pure JavaScript/WASM — no native bindings:
- `commander` — CLI framework
- `sql.js` + `sql.js-fts5` — SQLite in WebAssembly
- `zod` — schema validation
- `dotenv` — .env file loading

# CLAUDE.md

This is the Field Theory CLI: a local-first command-line companion for X bookmark sync, Field Theory Library workflows, portable commands, app install, and agent-facing context.

Agent recall contract (how to query the knowledge base from any agent): `docs/AGENTS-recall.md`.

## Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Run via tsx directly
npm run test         # Run tests
npm run start        # Run compiled dist/cli.js
```

## Architecture

Single CLI application built with Commander.js. Bookmark data is stored in `~/.fieldtheory/bookmarks/`; Library markdown is stored in `~/.fieldtheory/library/`; portable commands live under `~/.fieldtheory/commands/`; and Possible run artifacts live under `~/.fieldtheory/ideas/`.

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
| `src/library.ts` | Local Field Theory Library read/write helpers |
| `src/commands-files.ts` | Portable command file creation and validation |
| `src/app-open.ts` | Open Library pages in the packaged Mac app or a dev checkout |
| `src/app-install.ts` | Download and install packaged app releases |
| `src/skill.ts` | Install Field Theory agent skills for Claude Code and Codex |
| `src/ideas.ts` | Possible seeds, runs, jobs, and nightly schedules |

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

Field Theory app companion flow:

```text
~/.fieldtheory/library + ~/.fieldtheory/commands
                    ↓
              ft library / ft commands
                    ↓
    packaged Field Theory app or configured dev checkout
```

### Dependencies

All pure JavaScript/WASM — no native bindings:
- `commander` — CLI framework
- `sql.js` + `sql.js-fts5` — SQLite in WebAssembly
- `dotenv` — .env file loading

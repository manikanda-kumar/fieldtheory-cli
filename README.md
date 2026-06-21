# Field Theory CLI

Sync and store locally all of your X/Twitter bookmarks. Search, classify, and make them available to Claude Code, Codex, or any agent with shell access.

Free and open source. Designed for Mac.

## Install

```bash
npm install -g fieldtheory
```

Requires Node.js 20+. A Chrome-family browser or Firefox is recommended for session sync; OAuth is available for all platforms.

## Quick start

```bash
# 1. Sync your bookmarks (needs a supported browser logged into X)
ft sync

# 2. Search them
ft search "distributed systems"

# 3. Explore
ft viz
ft categories
ft stats
```

On first run, `ft sync` extracts your X session from your browser and downloads your bookmarks into `~/.fieldtheory/bookmarks/`.

## Commands

### Sync

| Command | Description |
|---------|-------------|
| `ft sync` | Download and sync bookmarks. Media download is off by default. No API required. |
| `ft sync --media` | Sync bookmarks, then fetch missing media (photos, video posters, capped videos) |
| `ft sync --media --skip-profile-images` | Sync bookmarks and post media but skip author profile images |
| `ft sync --rebuild` | Full re-crawl of all bookmarks |
| `ft sync --continue` | Resume a paused or interrupted sync from the saved cursor |
| `ft sync --gaps` | Backfill quoted tweets, expand truncated/X Article text, enrich linked articles, and fill any media gaps |
| `ft sync --folders` | Also sync X bookmark folder tags (read-only mirror of X state) |
| `ft sync --folder <name>` | Sync a single folder by name (exact or unambiguous prefix) |
| `ft sync --classify` | Sync then classify new bookmarks with LLM |
| `ft sync --api` | Sync via OAuth API (cross-platform) |
| `ft sync-raindrop` | Sync browser bookmarks from Raindrop.io into the unified index |
| `ft sync-github-stars` | Sync GitHub starred repositories into the unified index |
| `ft sync-github-stars --limit 200 --classify` | Partial GitHub stars sync, then regex-classify canonical rows |
| `ft sync-youtube --playlist <url-or-id>` | Sync a public YouTube playlist into local markdown notes and the unified index |
| `ft sync-following` | Sync the accounts you follow on X into a local searchable roster |
| `ft sync-following --classify` | Sync following list then classify domains/expertise with LLM |
| `ft sync-following --regex` | Sync following list then classify with regex (cheap, no LLM) |
| `ft sync-following --rebuild` | Full re-crawl of your following list |
| `ft auth` | Set up OAuth for API-based sync (optional) |

### Following roster and expertise index

`ft sync-following` downloads the accounts you follow on X and stores them locally for search:

```bash
ft sync-following                         # sync your following list
ft sync-following --classify              # sync + LLM classify domains/expertise
ft sync-following --browser chrome        # specify browser for session cookies
ft sync-following --max-pages 20          # limit pages (each page ~100 accounts)
ft sync-following --rebuild               # full re-crawl

ft experts search "agent harness" --json  # search by expertise/bio/domain
ft experts list --domain ai               # list followed accounts in a domain
ft experts list --sort overlap            # sort by bookmark overlap count
ft experts show @handle --json            # full profile + bookmark overlap + top posts
ft experts stats                          # roster statistics

ft classify-following                     # classify with LLM (requires claude or codex)
ft classify-following --regex             # classify with regex (cheap)
```

Data is stored at `~/.fieldtheory/bookmarks/following/`:

- `following.jsonl` — raw account records
- `following.db` — SQLite FTS5 search index
- `meta.json` — sync cursor, last updated, count

**Auth:** Uses the same browser session cookie path as `ft sync`. The `twid` cookie
is used to determine your X user ID for the following list query. No paid API tier required.

**Local-first research workflow:**

```bash
ft search --unified "agent harness" --json   # tier 1: bookmarks
ft experts search "agent harness" --json     # tier 2: trusted accounts you follow
# tier 3: broader web/X research via external tools (e.g. grok-cli)
```

Check your bookmarks first, then your trusted following roster for domain experts,
then fall through to broader web search only when local signal is insufficient.

### YouTube playlists

`ft sync-youtube` turns a public YouTube playlist into local searchable artifacts:

```bash
ft sync-youtube --playlist PL... --overview none
ft sync-youtube --playlist "https://www.youtube.com/playlist?list=PL..." --overview audio
ft sync-youtube --playlist PL... --overview video --target-minutes 12 --slide-confidence 0.6
ft sync-youtube --playlist PL... --cookies-from-browser chrome --impersonate chrome
ft sync-youtube --video-ids-file docs/retry-video-ids.txt --overview slides --cookies-from-browser chrome --impersonate chrome
```

What it does:

- Resolves a public playlist with `yt-dlp` when available, otherwise parses the public playlist page.
- For targeted retries, `--video-ids-file <path>` reads newline-delimited video IDs and reprocesses only those videos instead of forcing a whole playlist.
- Fetches transcripts and metadata, then uses your Field Theory LLM engine to generate structured notes.
- Writes markdown notes to `~/.fieldtheory/library/youtube/<YYYY-MM>/<videoId>.md` and updates `~/.fieldtheory/library/youtube/index.html`.
- Stores state and heavy artifacts under `~/.fieldtheory/bookmarks/youtube/`.
- Indexes each video into the unified canonical SQLite index so `ft search --unified` can find it.

LLM and TTS configuration:

- Notes and overview scripts use the same local engine design as the rest of Field Theory: `ft model` / autodetect picks `claude` or `codex`, and OpenRouter is used as the fallback when a local engine is unavailable or fails.
- `--engine <claude|codex>` overrides the local engine for one YouTube sync.
- `--model <model>` is passed through to the selected engine. If the value contains `/`, it is also used as the primary OpenRouter fallback model ID.
- `--effort <level>` is passed through to the selected engine. Field Theory accepts `low`, `medium`, `high`, `xhigh`, and `max`; the installed engine may reject values it does not support.
- Audio/video overview TTS uses TTS engines directly. `OPENAI_API_KEY` is the supported high-quality path; `--tts say` and `--tts piper` are local fallback options when those commands are installed. OpenRouter does not provide TTS endpoints.

YouTube 429 mitigation:

- `--cookies-from-browser <spec>` passes browser cookies to `yt-dlp` for playlist, metadata, subtitle, and slide extraction. Examples: `chrome`, `chrome:Profile 1`. You can also set `FT_YOUTUBE_COOKIES_FROM_BROWSER`.
- `--cookies-file <path>` passes a Netscape cookies file to direct `yt-dlp` calls. You can also set `FT_YOUTUBE_COOKIES_FILE`.
- `--impersonate <target>` passes a `yt-dlp` impersonation target such as `chrome`. You can also set `FT_YOUTUBE_IMPERSONATE`. This requires `yt-dlp --list-impersonate-targets` to show available `curl_cffi` targets.
- If Homebrew `yt-dlp` shows `curl_cffi` as unsupported, install a supported release into its libexec environment, e.g. `/opt/homebrew/opt/yt-dlp/libexec/bin/python -m pip install 'curl_cffi>=0.14,<0.15' --force-reinstall`.

Recommended YouTube model profiles:

| Engine | Good default | Higher quality | Notes |
|--------|--------------|----------------|-------|
| `claude` | `--engine claude --model sonnet --effort medium` | `--engine claude --model opus --effort high` | Claude Code accepts aliases such as `sonnet` and `opus`, plus full model names such as `claude-sonnet-4-6`. Current Claude Code help lists effort levels `low`, `medium`, `high`, `xhigh`, and `max`. |
| `codex` | `--engine codex --model gpt-5.4-mini --effort medium` | `--engine codex --model gpt-5.4 --effort high` | Codex model names depend on the installed Codex CLI and account access. Field Theory passes effort as `model_reasoning_effort`; if your Codex build rejects `xhigh` or `max`, use `low`, `medium`, or `high`. |
| OpenRouter fallback | `--model openai/gpt-4o-mini` | `--model openai/gpt-4o` or another provider model ID | Used automatically as fallback. A slash-style `--model` value is treated as an OpenRouter model ID. |

Examples:

```bash
ft sync-youtube --playlist PL... --engine claude --model sonnet --effort medium
ft sync-youtube --playlist PL... --engine codex --model gpt-5.4-mini --effort medium
ft sync-youtube --playlist PL... --model openai/gpt-4o-mini
```

Vision note: modern Claude and GPT/Codex models can be vision-capable, but Field Theory's current local YouTube engine adapter sends text prompts only. Transcript-based notes and scripts use local `claude`/`codex`; slide detection can use OCR heuristics and, when available, OpenRouter vision fallback.

Optional external tools:

- `yt-dlp` improves playlist, metadata, and transcript extraction.
- `summarize` can provide Whisper transcript and slide/OCR extraction when native transcript sources fail.
- `ffmpeg` is required for video overview assembly.

Overview modes:

- `--overview none` (default): notes only.
- `--overview audio`: notes plus a local audio overview artifact when TTS succeeds; notes still write if TTS fails.
- `--overview video`: notes plus a slide-gated video overview for slide-heavy talks/screen-shares. Non-slide-heavy videos stay notes-only; video assembly failures degrade to audio when TTS succeeds.

### Search and browse

| Command | Description |
|---------|-------------|
| `ft search <query>` | Full-text search with BM25 ranking |
| `ft search --unified <query>` | Search deduped X, Raindrop, GitHub Stars, and YouTube bookmarks |
| `ft list --unified` | List unified canonical bookmarks |
| `ft list --unified --source github-stars` | List canonical rows that include a GitHub star source |
| `ft show --unified <id>` | Show one unified canonical bookmark |
| `ft list` | Filter by author, date, category, domain, or folder |
| `ft list --folder <name>` | Show bookmarks in an X bookmark folder |
| `ft show <id>` | Show one bookmark in detail |
| `ft sample <category>` | Random sample from a category |
| `ft stats` | Top authors, languages, date range |
| `ft viz` | Terminal dashboard with sparklines, categories, and domains |
| `ft categories` | Show category distribution |
| `ft domains` | Subject domain distribution |
| `ft folders` | Show X bookmark folder distribution (requires `ft sync --folders` first) |

### Classification

| Command | Description |
|---------|-------------|
| `ft classify` | Classify by category and domain using LLM |
| `ft classify --regex` | Classify by category using simple regex |
| `ft classify --unified --regex` | Classify unified canonical bookmarks with the regex classifier |
| `ft classify-domains` | Classify by subject domain only (LLM) |
| `ft classify --engine <name>` | Override the LLM engine for one run (also works on `ft sync --classify` and `ft classify-domains`) |
| `ft model` | View or change the default LLM engine |

### Knowledge base

| Command | Description |
|---------|-------------|
| `ft md` | Export bookmarks as individual markdown files, including enriched article text |
| `ft md --changed` | Re-export only markdown files whose source bookmark data changed |
| `ft md --canonical --source github-stars` | Export deterministic GitHub repository markdown pages |
| `ft wiki` | Compile a Karpathy-style interlinked knowledge base |
| `ft ask <question>` | Ask questions against the knowledge base |
| `ft ask <question> --save` | Ask and save the answer as a concept page |
| `ft lint` | Health-check the wiki for broken links and missing pages |
| `ft lint --fix` | Auto-fix fixable wiki issues |

### Possibility runs

| Command | Description |
|---------|-------------|
| `ft seeds search "<query>" --create` | Save a bookmark-grounded seed |
| `ft repos add <path>` | Add a repo to the default repo set |
| `ft possible` | Interactive seed + repo + frame wizard |
| `ft possible run --defaults` | Re-run with the most-recently-used seed and saved repos |
| `ft possible run --background` | Start a run as a background job |
| `ft possible prompt <node-id>` | Print the goal prompt for one plotted node |
| `ft possible nightly install` | Install a nightly Possible run on macOS |

### Field Theory app companion

| Command | Description |
|---------|-------------|
| `ft paths --json` | Show canonical bookmarks, Library, Commands, and compatibility paths |
| `ft status --json` | Show bookmark/classification status plus Field Theory paths |
| `ft library search <query>` | Search local Field Theory Library markdown |
| `ft library show <path>` | Print a Library page and its version metadata with `--json` |
| `ft library create <path> --stdin` | Create a new Library page under `~/.fieldtheory/library` |
| `ft library update <path> --stdin --expected-sha256 <hash>` | Replace a Library page with conflict protection |
| `ft library delete <path>` | Move a Library page to Trash; the Mac app owns remote sync tombstones |
| `ft library open <path>` | Open a Library page in the Field Theory Mac app |
| `ft commands list` | List portable commands under `~/.fieldtheory/commands` |
| `ft commands new <name>` | Create a reusable portable command |
| `ft commands validate [name]` | Check command shape and guardrails |
| `ft install app` | Download and install the latest Field Theory Mac app from `afar1/field-releases` |

`ft library open` targets the packaged Field Theory app by bundle id (`com.fieldtheory.app`) instead of trusting the system-wide `fieldtheory://` handler. That avoids accidentally opening a generic Electron development app when another checkout registered the same URL scheme.

For local Field Theory app development, point the CLI at the dev checkout:

```bash
export FT_APP_DEV_DIR=/Users/you/dev/fieldtheory/mac-app
ft library open notes/example.md
```

Packaged variants can override the bundle id with `FT_APP_BUNDLE_ID`. Advanced development launchers can set `FT_APP_OPEN_COMMAND` to an executable that receives the deep-link URL as its first argument.

### Agent integration

| Command | Description |
|---------|-------------|
| `ft skill install` | Install `/fieldtheory` skill for Claude Code and Codex |
| `ft skill show` | Print skill content to stdout |
| `ft skill uninstall` | Remove installed skill files |

### Utilities

| Command | Description |
|---------|-------------|
| `ft index` | Rebuild search index from JSONL cache (preserves classifications) |
| `ft fetch-media` | Backfill/download X media assets for existing bookmarks (default: all pending bookmarks) |
| `ft fetch-media --skip-profile-images` | Download post media without author profile images |
| `ft status` | Show sync/classification status and data location |
| `ft path` | Print data directory path |

## Agent integration

Install the `/fieldtheory` skill so your agent automatically searches your bookmarks when relevant:

```bash
ft skill install     # Auto-detects Claude Code and Codex
```

Then ask your agent:

> "What have I bookmarked about cancer research in the last three years and how has it progressed?"

> "I bookmarked a number of new open source AI memory tools. Pick the best one and figure out how to incorporate it in this repo."

> "Your goal is to look at AI agent bookmarks and come up with a roadmap plotted in the grid of what I should do next across the Field Theory CLI and Mac app projects."

> "Every day please sync any new X bookmarks using the Field Theory CLI."

Works with Claude Code, Codex, or any agent with shell access.

## Scheduling

Sync with cron:

```bash
# Sync every morning at 7am
0 7 * * * ft sync

# Sync and classify every morning
0 7 * * * ft sync --classify
```

Run Possible every night on macOS with LaunchAgent:

```bash
ft seeds search "agents" --days 90 --limit 8 --frame leverage-specificity --create
ft repos add ~/dev/fieldtheory
ft repos add ~/dev/fieldtheory-cli

ft possible nightly install --time 02:00 --defaults --model opus --effort medium --nodes 5
ft possible nightly show
```

Nightly schedules are stored under `~/.fieldtheory/ideas/nightly/`. Each tick starts a normal background job under `~/.fieldtheory/ideas/jobs/`, using your local logged-in CLI sessions and the current `PATH` captured in the LaunchAgent plist.

`ft` respects standard proxy environment variables for network requests: `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, and `NO_PROXY`.

## Data

Data is stored locally under `~/.fieldtheory/`:

```
~/.fieldtheory/bookmarks/
  bookmarks.jsonl         # raw bookmark cache (one per line)
  bookmarks.db            # SQLite FTS5 search index
  bookmarks-meta.json     # sync metadata
  oauth-token.json        # OAuth token (if using API mode, chmod 600)
  youtube/
    state.json            # YouTube playlist/video processing state
    artifacts/<videoId>/  # audio/video/frames and other heavy generated artifacts
  raindrop/
    bookmarks.jsonl       # raw Raindrop bookmark cache
  github-stars/
    stars.jsonl           # raw GitHub starred repository cache
    meta.json             # GitHub stars incremental sync metadata

~/.fieldtheory/library/
  index.md                # markdown knowledge base (ft wiki / ft md)
  youtube/<videoId>.md    # YouTube transcript notes

~/.fieldtheory/commands/
  *.md                    # portable commands used by Field Theory and agents

~/.fieldtheory/ideas/
  seeds/runs/nodes/       # Possible seeds, runs, and node prompt artifacts
  batches/jobs/nightly/   # Multi-repo batches, background jobs, and schedules
```

Override locations with `FT_DATA_DIR`, `FT_LIBRARY_DIR`, and `FT_COMMANDS_DIR`:

```bash
export FT_DATA_DIR=/path/to/custom/dir
export FT_LIBRARY_DIR=/path/to/custom/library
export FT_COMMANDS_DIR=/path/to/custom/commands
```

To remove bookmark and Library data: `rm -rf ~/.fieldtheory/bookmarks ~/.fieldtheory/library`

## Categories

| Category | What it catches |
|----------|----------------|
| **tool** | GitHub repos, CLI tools, npm packages, open-source projects |
| **security** | CVEs, vulnerabilities, exploits, supply chain |
| **technique** | Tutorials, demos, code patterns, "how I built X" |
| **launch** | Product launches, announcements, "just shipped" |
| **research** | ArXiv papers, studies, academic findings |
| **opinion** | Takes, analysis, commentary, threads |
| **commerce** | Products, shopping, physical goods |

Use `ft classify` for LLM-powered classification that catches what regex misses.

## Windows Notes

In PowerShell, use `fieldtheory` or `ft.cmd` instead of `ft` because `ft` is already a built-in alias for `Format-Table`.

If browser session sync cannot find the right profile, pass the browser and profile explicitly:

```powershell
fieldtheory sync --browser chrome --chrome-profile-directory "Default"
fieldtheory sync --browser edge --chrome-profile-directory "Default"
```

For Firefox, if profile detection misses the profile, pass the profile directory explicitly with `--firefox-profile-dir`.

If cookie extraction still fails, close the browser completely and retry. As a last resort, pass cookies manually:

```powershell
fieldtheory sync --cookies <ct0> <auth_token>
```

Treat `ct0` and `auth_token` like passwords. Do not paste them into logs, issues, or chat.

## Platform support

| Feature | macOS | Linux | Windows |
|---------|-------|-------|---------|
| Session sync (`ft sync`) | Chrome, Chromium, Brave, Edge, Helium, Comet, Dia, Firefox | Chrome, Chromium, Brave, Edge, Firefox | Chrome, Chromium, Brave, Edge, Firefox |
| OAuth API sync (`ft sync --api`) | Yes | Yes | Yes |
| Search, list, classify, viz, wiki | Yes | Yes | Yes |

Session sync extracts cookies from your browser's local database. Use `ft sync --browser <name>` to pick a browser. On Windows, Firefox requires Node.js 22.5+ or `sqlite3` on PATH. For unsupported browsers or platforms, use `ft auth` + `ft sync --api`.

## Security

**Your data stays local.** No telemetry, no analytics, nothing phoned home. The CLI only makes network requests to X's API during sync.

**Chrome session sync** reads cookies from Chrome's local database, uses them for the sync request, and discards them. Cookies are never stored separately.

**OAuth tokens** are stored with `chmod 600` (owner-only). Treat `~/.fieldtheory/bookmarks/oauth-token.json` like a password.

**The default sync uses X's internal GraphQL API**, the same API that x.com uses in your browser. For the official v2 API, use `ft auth` + `ft sync --api`.

## License

MIT — [fieldtheory.dev/cli](https://fieldtheory.dev/cli)

## Star History

<a href="https://www.star-history.com/?repos=afar1%2Ffieldtheory-cli&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=afar1/fieldtheory-cli&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=afar1/fieldtheory-cli&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=afar1/fieldtheory-cli&type=date&legend=top-left" />
 </picture>
</a>

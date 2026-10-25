# Orb daily pipeline

## First stage: local-output pilot

Run `scripts/sync-orb.sh --check`, then `--dry-run`, then `--run`.
The pilot writes only the orb's private data checkout. It does not commit/push,
upload to NotebookLM, run the Mac wrapper, or change either schedule.
Sources: Raindrop, Tweetsmash, GitHub stars, RSS, and both saved/AI Engineer
YouTube playlists. Canonical index, Markdown, and daily digest follow ingestion.
The cap is the newest 20 entries per playlist, not 20 unprocessed entries.
X ingestion and local project scans are excluded; existing mirrored data remains.

## Provisioning

- Run `.agents/setup` (software only, safe for shared project snapshots).
- At runtime, clone `manikanda-kumar/fieldtheory` to `~/.fieldtheory` using Amp's
  GitHub connection. Use a full checkout, not a recall-only sparse checkout.
  Run `git lfs install --local` and `git lfs pull`; verify `bookmarks/bookmarks.db`
  is SQLite, not an LFS pointer. Preserve `bookmarks/youtube/state.json`, RSS
  feeds/caches, the library, and remaining private data.
- Provide `RAINDROP_TOKEN` (or `RAINDROP_TEST_TOKEN`) and `TWEETSMASH_API_KEY`
  through Amp Secrets. Optional OpenRouter fallback uses `OPENROUTER_API_KEY`.
  Never copy the Mac's `.env` or browser profile into repository files.
- Install/authenticate Claude Code inside the orb and approve unattended use.
  Run `ft model claude` with the built CLI to select the notes engine; the
  ignored `bookmarks/.preferences` file does not arrive through Git.
  The wrapper selects Opus medium, with Sonnet fallback (no agy/Grok required).
- GitHub API authentication is independent of Git transport; check `gh api user`.
- Test YouTube captions from the orb's IP. If needed, securely provision
  `FT_YOUTUBE_COOKIES_FILE` pointing at a private Netscape cookie file. Session
  expiry and datacenter restrictions can still block downloads.

`--check` checks prerequisites and Claude/GitHub login without running ingestion.
`--dry-run` invokes only the CLI plan; it may create its empty data directory,
but performs no source requests or publishing. `--run` stops on failed preflight
and prevents concurrent runs within this orb. A failed source makes the CLI exit
nonzero even though later steps may produce a partial digest; inspect its report.

## Cutover after a successful pilot

1. Confirm the Mac full sync is stopped and disable its launchd daily job.
   Retain separate Mac collectors for browser tabs and project/session snapshots.
2. Reconcile pilot outputs before pulling a fresh canonical snapshot. Never
   merge independently modified SQLite databases or run two canonical writers.
3. Add reviewed publication of data-only changes to the private repository,
   including LFS. Failed pushes must retain local outputs and report failure.
4. Schedule this persistent orb thread at 09:00 Asia/Calcutta (03:30 UTC), with
   `TZ=Asia/Calcutta` also applied to processing. Use Amp's scheduler, not cron
   inside a sleeping orb. Each run should refresh clean data before processing,
   run the pipeline, verify/publish results, and report partial failures.

No schedule is enabled by these scripts. Do not add the full job to
`.agents/resume`: a manual wake must not accidentally start another daily run.

## Production entry point

After the verified handoff, create the machine-local marker
`~/.config/fieldtheory/orb-canonical-writer` recording the handoff evidence.
Only then use `scripts/sync-orb.sh --daily`. It holds the same lock across
refresh, ingestion, and publication. It refuses dirty or locally-ahead data
checkouts before refreshing, fast-forwards from origin/main, hydrates LFS, and
rechecks prerequisites. It publishes only pipeline-owned bookmarks/library data,
excluding project snapshots and credential-like paths. Existing staged changes,
SQLite sidecars, failed SQLite integrity checks, or remote races stop publication;
local output is retained for recovery. Python 3 supplies the SQLite integrity check.

### Mac collector exchange

The Mac collector uses a separate checkout and publishes to `origin/mac-collectors`,
never to `main`. Before ingestion, the orb refresh explicitly imports only:

- `bookmarks/projects/projects.jsonl` and `bookmarks/projects/meta.json`
- `library/projects/*.md` (direct children only) and `library/projects-active.md`

Refresh commits and publishes this isolated snapshot to `main` before running the
pipeline; it is **not** a read-only operation. It never merges collector history or
imports that branch's database. Removed project notes are removed on `main` too.
Missing required snapshot files, symlinks, executable files, or a failed push stop
the run and retain local state for review. An unchanged snapshot adds no commit.
Normal pipeline publication still rejects project edits.

The Mac aims to publish at 08:00 IST. If it is asleep, the orb uses the latest
previously published snapshot; `bookmarks/projects/meta.json:lastSyncedAt` records
its age. Browser collectors publish to Raindrop independently. Neither collector
must be online for the orb's 09:00 ingestion, provided the initial snapshot branch
exists. A failed snapshot push leaves an unpublished commit: reconcile it before
retrying, rather than bypassing the clean-checkout guard.

Partial source updates are preserved and published, but source exit failures and
RSS per-feed failures produce a nonzero daily exit. Read the per-source log, not
just the final success line. Do not edit a shell script while it is running.

The CLI currently labels rolling digests with the UTC date, even when TZ is set.
At 09:00 IST that matches the Indian calendar date; an overnight manual pilot can
reuse the previous UTC day's file. Existing digests are not overwritten by normal
sync. Validate an explicit `daily --write --epub --force` pilot separately, and
preserve the Mac's original digest/watermark during initial data reconciliation
so the next scheduled digest includes all unreviewed new saves.

### Opt-in browser bookmark feed

Create the local marker `~/.config/fieldtheory/orb-browser-bookmarks` after browser
sign-in and a reviewed dry run. Daily mode then imports downloaded bookmarks into
Raindrop before normal ingestion, under the existing writer lock. Other modes
(`--check`, `--dry-run`, `--run`) never perform this external write.

The importer reads both `Bookmarks` and `AccountBookmarks` in these orb profiles:

- Chrome: `~/.config/fieldtheory-browser-profiles/chrome/Default`
- Vivaldi: `~/.config/vivaldi/Default` (not the older custom launcher profile)

Supervised headless browser services keep these files synced while the orb is
awake; they pause with the orb. The feed reads the latest downloaded snapshot,
not the cloud directly, and does not guarantee a new sync cycle after every wake.
No tabs, cookies, passwords or browser settings are imported or modified.

Preview or run manually while holding the same lock:

```sh
flock -n ~/.fieldtheory/sync-orb.lock node scripts/sync-browser-bookmarks.mjs --dry-run
flock -n ~/.fieldtheory/sync-orb.lock node scripts/sync-browser-bookmarks.mjs --run
```

The first run includes historical bookmarks. Normalized URLs are deduplicated
across browsers and the full Raindrop account. New links go into `Browser Bookmarks`
with browser tags and their original save date (earliest across duplicates).
Invalid dates and non-HTTP(S)/credentialed URLs are skipped. Existing Raindrop
items are not edited; nothing is deleted. A bookmark removed from Raindrop but
still present in a browser can be imported again on a later run.

Writes are batched at 100. Only explicit HTTP 429 rejections are retried (at most
twice, respecting Retry-After up to 90 seconds, or waiting 60 seconds if absent).
Lost responses and other errors are never retried automatically. Re-inventory
before retrying: a partial batch may already exist remotely.
Failures remain visible as a nonzero daily exit, while successful imports can still
flow through ingestion and publication. This manual feed alone writes only to
Raindrop; the next daily run updates the private canonical index and library.

### Chrome tabs from other devices

The local `~/.config/fieldtheory/orb-chrome-tabs` marker enables
`scripts/sync-chrome-tabs.mjs --run` after bookmarks and before Raindrop ingestion.
The same script accepts `--dry-run` for a live browser/API read without imports;
hold `~/.fieldtheory/sync-orb.lock` for manual calls as above.

To exclude a computer from this feed, put its exact Chrome device name in
`~/.config/fieldtheory/chrome-tabs-excluded-devices`, one name per line. Blank
lines are ignored; without the file, all devices remain eligible. Exclusions
apply before URL deduplication, and the run report marks matching devices
`excluded: true`. This does not change Chrome's account sync settings or remove
previously imported tabs. Keep the machine-specific file outside Git.

The supervised `fieldtheory-chrome-sync` service needs its existing signed-in
profile plus `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9225`.
Never create a portal for this debugging port. `agent-browser` reads only the
`chrome://history/syncedTabs` foreign-device cards in its own tab, then closes
that tab and detaches. It does not open the remote links, read local history,
change sync settings, or export credentials. Missing/empty foreign-session UI
fails visibly (including when there are genuinely no remote tabs).

Missing HTTP(S) links go into `Chrome Saved Tabs`, with `chrome`/`synced-tabs`
tags and device provenance. Dates mean **last tab activity**, not bookmark save
time. Stale devices are reported with Chrome's freshness label, not silently
treated as current. This reads the browser's cached view (up to its native
10-device limit); it cannot force a sleeping remote device to sync. Existing
Raindrop URLs are skipped account-wide.

### Vivaldi tabs from other devices

The local `~/.config/fieldtheory/orb-vivaldi-tabs` marker enables
`scripts/sync-vivaldi-tabs.mjs --run` after Chrome tabs and before Raindrop
ingestion. The same script accepts `--dry-run` for a live CDP/API read without
imports; hold `~/.fieldtheory/sync-orb.lock` for manual calls as above.

To exclude a computer from this feed, put its exact Vivaldi device name in
`~/.config/fieldtheory/vivaldi-tabs-excluded-devices`, one name per line. Blank
lines are ignored; without the file, all devices remain eligible. Exclusions
apply before URL deduplication, and the run report marks matching devices
`excluded: true`. This does not change Vivaldi's account sync settings or remove
previously imported tabs. Keep the machine-specific file outside Git.

The supervised `fieldtheory-vivaldi-sync` service needs its existing signed-in
profile plus `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9224`.
Never create a portal for this debugging port. The reader talks to loopback CDP
directly and evaluates `chrome.sessions.getDevices()` in Vivaldi's UI extension
target. It does not use `agent-browser` (that path hangs on this UI), open the
remote links, read local `about:blank` tabs, change sync settings, or export
credentials. Missing/empty foreign sessions fail visibly (including when there
are genuinely no remote tabs).

Missing HTTP(S) links go into `Vivaldi Saved Tabs`, with `vivaldi`/`synced-tabs`
tags and device provenance. Dates mean **last tab activity** (`session.lastModified`
Unix seconds), not bookmark save time. Stale devices are reported with that
timestamp, not silently treated as current. This reads the browser's cached
view; it cannot force a sleeping remote device to sync. Existing Raindrop URLs
are skipped account-wide.

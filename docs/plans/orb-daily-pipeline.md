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

Partial source updates are preserved and published, but source exit failures and
RSS per-feed failures produce a nonzero daily exit. Read the per-source log, not
just the final success line. Do not edit a shell script while it is running.

The CLI currently labels rolling digests with the UTC date, even when TZ is set.
At 09:00 IST that matches the Indian calendar date; an overnight manual pilot can
reuse the previous UTC day's file. Existing digests are not overwritten by normal
sync. Validate an explicit `daily --write --epub --force` pilot separately, and
preserve the Mac's original digest/watermark during initial data reconciliation
so the next scheduled digest includes all unreviewed new saves.

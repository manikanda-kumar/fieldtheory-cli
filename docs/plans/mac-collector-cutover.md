# Mac collector handoff

The orb owns canonical ingestion, `bookmarks.db`, daily digests and publication
to the private data repository's `main`. The Mac's full daily launchd job
`dev.fieldtheory.sync-all-daily` is disabled and unloaded. Its original plist
is retained, and `~/.config/fieldtheory/mac-collector-only` blocks accidental
manual invocation of the old `~/.fieldtheory/sync-all.sh` wrapper.

## Collector contract

`scripts/sync-mac-collectors.py` runs under `dev.fieldtheory.mac-collectors`
at 08:00 Mac local time (Asia/Calcutta), using `caffeinate -i` and an exclusive
file lock. Launchd runs the missed calendar job on wake; an asleep Mac does not
block the orb's 09:00 daily pipeline, which uses the latest published snapshot.

- Safari open tabs and Vivaldi synced tabs go to Raindrop using the existing
  tools-repo browser script and its shared browser lock. The separate existing
  09:00 browser-bookmark launchd collector remains unchanged.
- Local repositories and agent sessions are collected through `syncProjects()`
  directly, **not** `ft sync-projects`, which rebuilds canonical SQLite.
- Both output roots point to the sparse `~/.fieldtheory-mac-collectors` checkout.
  It must be on branch `mac-collectors`, without a checked-out `bookmarks.db`.
- The collector pushes only `HEAD:refs/heads/mac-collectors`. It publishes
  `bookmarks/projects/projects.jsonl`, `bookmarks/projects/meta.json`,
  `library/projects/*.md`, and `library/projects-active.md`.
- Local `agent-sessions index sync` still refreshes session recall. Neither
  NotebookLM publication nor the old chief-of-staff mirror runs in this job.
- Dirty checkouts, existing staged edits, locally ahead commits, non-project
  changes and remote races fail closed. Failed publication retains local output.
  Successful partial snapshots are published but collection errors return nonzero.

The orb must explicitly fetch and import only those project paths before
ingestion. Do not merge the collector branch into `main` or import its database,
daily digests or watermarks. Raindrop remains the browser exchange; the orb reads
it through its normal source sync. The orb thread owns the import integration.

## Validation and recovery

Run `python3 scripts/sync-mac-collectors.py --check` for read-only validation and
`PYTHONDONTWRITEBYTECODE=1 python3 tests/mac-collectors.test.py` for isolated Git
publication tests. Logs are in `~/.fieldtheory/mac-collectors.log`.

The initial cutover backup is `~/.fieldtheory-cutover-backups/2026-09-28-mac/`:
full private data checkout, original launchd plist/status, digest hashes and DB
hash. A fresh remote LFS download was compared with the Mac SQLite DB; its
`quick_check` returned `ok`, with delete journal mode and no open DB handles.
The original daily digests and watermark were not regenerated or advanced.

Rollback requires first stopping orb publication and verifying it has no live
writer. Only then reconcile any newer orb data, remove the Mac-only marker,
enable and bootstrap the original launchd job. Never restore the backup over
newer canonical data or run both canonical writers together.

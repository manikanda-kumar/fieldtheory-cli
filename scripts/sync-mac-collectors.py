#!/usr/bin/env python3
"""Mac-only collectors; publish project snapshots, never the canonical database."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys

BRANCH = "mac-collectors"
PATHS = ["bookmarks/projects/projects.jsonl", "bookmarks/projects/meta.json",
         "library/projects", "library/projects-active.md"]


def allowed_path(value):
    p = Path(value)
    return (value in PATHS[:2] or value == PATHS[3] or
            (p.parent.as_posix() == PATHS[2] and p.suffix == ".md"))


def run(args, **kwargs):
    print("Running:", " ".join(map(str, args)), flush=True)
    return subprocess.run(args, check=True, **kwargs)


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def validate_checkout(root, canonical):
    if root.resolve() == canonical.resolve():
        raise RuntimeError("Collector checkout must not be canonical ~/.fieldtheory")
    if git(root, "branch", "--show-current") != BRANCH:
        raise RuntimeError("Collector checkout must be on mac-collectors, never main")
    if (root / "bookmarks/bookmarks.db").exists():
        raise RuntimeError("Collector checkout must be sparse: no canonical database")
    if git(root, "status", "--porcelain"):
        raise RuntimeError("Unpublished collector edits exist; preserve and reconcile them first")


def publish(root):
    if git(root, "branch", "--show-current") != BRANCH:
        raise RuntimeError("Refusing to publish from another branch")
    if git(root, "diff", "--cached", "--name-only"):
        raise RuntimeError("Unexpected staged changes")
    changed = git(root, "diff", "--name-only", "-z").split("\0")
    changed += git(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0")
    files = sorted(set(filter(None, changed)))
    if any(not allowed_path(file) for file in files):
        raise RuntimeError("Non-project output detected; refusing publication")
    if files:
        run(["git", "-C", str(root), "add", "--", *files])
        run(["git", "-C", str(root), "diff", "--cached", "--check"])
        run(["git", "-C", str(root), "commit", "-m", "data: refresh Mac project and session snapshots"])
    run(["git", "-C", str(root), "push", "origin", f"HEAD:refs/heads/{BRANCH}"])
    remote = git(root, "ls-remote", "origin", f"refs/heads/{BRANCH}").split()[0]
    if git(root, "rev-parse", "HEAD") != remote:
        raise RuntimeError("Remote collector snapshot verification failed")
    print(f"Published collector snapshot: {remote}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Read-only checkout validation")
    args = parser.parse_args()
    home = Path.home()
    repo = Path(__file__).resolve().parent.parent
    root = home / ".fieldtheory-mac-collectors"
    validate_checkout(root, home / ".fieldtheory")
    if args.check:
        print("Collector checkout validated; no canonical DB or main-branch writes")
        return 0
    lock_dir = home / ".config/fieldtheory"
    lock_dir.mkdir(parents=True, exist_ok=True)
    with (lock_dir / "mac-collectors.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another Mac collector is running", file=sys.stderr)
            return 1
        validate_checkout(root, home / ".fieldtheory")
        run(["git", "-C", str(root), "fetch", "origin", BRANCH])
        if git(root, "rev-list", "--count", f"origin/{BRANCH}..HEAD") != "0":
            raise RuntimeError("Unpublished commits exist; retry publication before collection")
        run(["git", "-C", str(root), "merge", "--ff-only", f"origin/{BRANCH}"])
        # Explicit roots keep both collection and its Markdown exports isolated.
        env = dict(os.environ, FT_DATA_DIR=str(root / "bookmarks"),
                   FT_LIBRARY_DIR=str(root / "library"))
        failures = []
        browser = home / "Github/tools/scripts/bookmarks/browser_bookmarks_to_raindrop_sync.sh"
        for mode in ("--vivaldi-synced", "--safari-tabs"):
            try:
                run([str(browser), mode], env=env)
            except (subprocess.SubprocessError, OSError) as error:
                print(f"Browser collector failed ({mode}): {error}", file=sys.stderr)
                failures.append(mode)
        run(["node", str(repo / "scripts/ensure-ready.mjs")], env=env)
        module = (repo / "dist/projects/sync.js").as_uri()
        code = (f"import {{syncProjects}} from {module!r}; "
                "const r = await syncProjects(); "
                "console.log(JSON.stringify({records:r.records.length,errors:r.errors,ampCloud:r.ampCloud}));")
        run(["node", "--input-type=module", "-e", code], env=env, cwd=repo)
        publish(root)
        meta = json.loads((root / "bookmarks/projects/meta.json").read_text())
        if meta.get("errors") or meta.get("ampCloud", {}).get("error"):
            print("Project snapshot published with collection errors; inspect meta.json", file=sys.stderr)
            failures.append("projects-partial")
        try:
            run([str(home / ".local/bin/agent-sessions"), "index", "sync"], timeout=1800)
        except (subprocess.SubprocessError, OSError) as error:
            print(f"Session index failed: {error}", file=sys.stderr)
            failures.append("session-index")
        return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.SubprocessError, OSError) as error:
        print(f"Collector failed; local outputs retained: {error}", file=sys.stderr)
        sys.exit(1)

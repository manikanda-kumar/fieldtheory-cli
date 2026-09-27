#!/usr/bin/env bash
set -euo pipefail
umask 077

# A local-output pilot, deliberately not the Mac wrapper. Never publishes data,
# imports browser tabs, scans local projects, or changes schedules.
root="$(dirname "$(dirname "$(realpath "$0")")")"
mode="${1:---check}"
if [[ $# -gt 1 || ! "$mode" =~ ^--(check|dry-run|run)$ ]]; then
  echo 'Usage: scripts/sync-orb.sh [--check|--dry-run|--run]' >&2
  exit 2
fi
export PATH="$HOME/.local/bin:$PATH"
export TZ=Asia/Calcutta
# Use the CLI's canonical home layout. FT_DATA_DIR also relocates ideas/X-list
# roots, so setting it to the bookmarks directory would hide mirrored context.
unset FT_DATA_DIR FT_LIBRARY_DIR
export FT_DAILY_ENGINE=claude FT_DAILY_MODEL=opus FT_DAILY_EFFORT=medium
export FT_DAILY_GROUND=1 FT_CLAUDE_MODEL=opus FT_CLAUDE_EFFORT=medium
export FT_ENRICH_ENGINE=claude
# No agy/Grok login is required for this first orb pipeline.
export FT_DAILY_FALLBACK_ENGINE=claude FT_DAILY_FALLBACK_MODEL=sonnet
export FT_DAILY_FALLBACK_ENGINE_2=claude FT_DAILY_FALLBACK_MODEL_2=sonnet

args=(sync-all --only raindrop,tweetsmash,github-stars,rss,youtube
  --playlist PLVmtzF5bqCTLutxk2SQvcH2SgCjwNWobk
  --playlist UULKPca3kwwd-B59HNr-_lvA --youtube-limit 20 --classify)
if [[ "$mode" == --dry-run ]]; then
  # No preflight logins, Git operations, hooks, or lock files on this path.
  exec node "$root/dist/cli.js" "${args[@]}" --dry-run
fi

failed=0
missing() { echo "NOT READY: $*" >&2; failed=1; }
for tool in node git git-lfs gh yt-dlp claude flock; do
  command -v "$tool" >/dev/null || missing "install $tool"
done
[[ -f "$root/dist/cli.js" ]] || missing 'build CLI with npm run build'
[[ -n "${RAINDROP_TOKEN:-}${RAINDROP_TEST_TOKEN:-}" ]] || missing 'configure Raindrop token in Amp Secrets'
[[ -n "${TWEETSMASH_API_KEY:-}" ]] || missing 'configure Tweetsmash API key in Amp Secrets'
gh api user --silent >/dev/null 2>&1 || missing 'authenticate GitHub API access'
claude auth status >/dev/null 2>&1 || missing 'authenticate Claude in this orb'
if ! node --input-type=module -e '
  import fs from "node:fs";
  const dir = `${process.env.HOME}/.fieldtheory/bookmarks`;
  const fd = fs.openSync(`${dir}/bookmarks.db`, "r");
  const header = Buffer.alloc(16);
  fs.readSync(fd, header, 0, 16, 0); fs.closeSync(fd);
  if (header.toString() !== "SQLite format 3\0") process.exit(1);
  JSON.parse(fs.readFileSync(`${dir}/youtube/state.json`, "utf8"));
  const prefs = JSON.parse(fs.readFileSync(`${dir}/.preferences`, "utf8"));
  if (prefs.defaultEngine !== "claude") process.exit(1);
' >/dev/null 2>&1; then
  missing 'hydrate private data/LFS, preserve YouTube state, and select ft model claude'
fi
[[ "$failed" == 0 ]] || exit 1
echo 'Preflight passed (credentials present; source access still needs a live pilot).'
[[ "$mode" == --run ]] || exit 0

# This only protects writers inside THIS orb; Mac cutover is a separate step.
exec 9>"$HOME/.fieldtheory/sync-orb.lock"
flock -n 9 || { echo 'Another orb sync is running.' >&2; exit 1; }
node "$root/dist/cli.js" "${args[@]}"

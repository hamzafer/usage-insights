#!/usr/bin/env bash
# Installs the weekly Report as a launchd agent that runs `bun run report` Mondays at 09:00.
# Usage: scripts/install-report-launchd.sh [--print] /path/to/usage-insights-checkout
#   --print  write the rendered plist to stdout and install nothing
set -euo pipefail

LABEL="dev.usage-insights.report"
PRINT=0
if [[ "${1:-}" == "--print" ]]; then PRINT=1; shift; fi
if [[ $# -ne 1 ]]; then
  echo "usage: $0 [--print] <path-to-repo-checkout>" >&2
  exit 64
fi

REPO="$(cd "$1" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../launchd/$LABEL.plist.template"
BUN="$(command -v bun || true)"
DATA_DIR="${USAGE_INSIGHTS_DATA_DIR:-$HOME/Library/Application Support/usage-insights}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[[ -n "$BUN" ]] || { echo "bun not found on PATH" >&2; exit 1; }
[[ -f "$REPO/package.json" ]] || { echo "not a usage-insights checkout: $REPO" >&2; exit 1; }

# Escape for both XML and the sed replacement.
escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/[|&\\]/\\&/g'
}

render() {
  sed -e "s|__BUN_DIR__|$(escape "$(dirname "$BUN")")|g" \
      -e "s|__BUN__|$(escape "$BUN")|g" \
      -e "s|__REPO__|$(escape "$REPO")|g" \
      -e "s|__DATA_DIR__|$(escape "$DATA_DIR")|g" \
      "$TEMPLATE"
}

if [[ $PRINT -eq 1 ]]; then render; exit 0; fi

mkdir -p "$DATA_DIR" "$HOME/Library/LaunchAgents"
render > "$PLIST"
plutil -lint "$PLIST" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL (Mondays 09:00). Log: $DATA_DIR/report.log"

#!/usr/bin/env bash
# Installs or uninstalls one Usage Insights launchd agent, rendered from launchd/job.plist.template.
#   recorder  `bun run record` every 5 minutes (it also starts the Backfills once per hour)
#   report    `bun run report` Mondays at 09:00 local time (a run missed while the Mac slept happens on wake)
#
# Usage:
#   scripts/launchd.sh install [--print] <recorder|report> <path-to-repo-checkout>
#   scripts/launchd.sh uninstall <recorder|report>
#   --print  write the rendered plist to stdout and install nothing
set -euo pipefail

usage() {
  echo "usage: $0 install [--print] <recorder|report> <path-to-repo-checkout>" >&2
  echo "       $0 uninstall <recorder|report>" >&2
  exit 64
}

ACTION="${1:-}"; shift || true
PRINT=0
if [[ "$ACTION" == "install" && "${1:-}" == "--print" ]]; then PRINT=1; shift; fi
JOB="${1:-}"; shift || true

case "$JOB" in
  recorder)
    SCRIPT="record"; LOG="recorder.log"; WHEN="every 5 minutes"; KEPT="recorded data"
    SCHEDULE='  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>'
    ;;
  report)
    SCRIPT="report"; LOG="report.log"; WHEN="Mondays 09:00"; KEPT="saved Reports"
    SCHEDULE='  <!-- Mondays at 09:00 local time. A run missed while the Mac slept happens on wake. -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>1</integer>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>'
    ;;
  *) usage ;;
esac
LABEL="dev.usage-insights.$JOB"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ "$ACTION" == "uninstall" ]]; then
  [[ $# -eq 0 ]] || usage
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Uninstalled $LABEL ($KEPT left in place)"
  exit 0
fi
[[ "$ACTION" == "install" && $# -eq 1 ]] || usage

REPO="$(cd "$1" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../launchd/job.plist.template"
BUN="$(command -v bun || true)"
DATA_DIR="${USAGE_INSIGHTS_DATA_DIR:-$HOME/Library/Application Support/usage-insights}"

[[ -n "$BUN" ]] || { echo "bun not found on PATH" >&2; exit 1; }
[[ -f "$REPO/package.json" ]] || { echo "not a usage-insights checkout: $REPO" >&2; exit 1; }

# Escape for both XML and the sed replacement.
escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/[|&\\]/\\&/g'
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

# The installer's USAGE_INSIGHTS_* settings and TELEGRAM_STATE_DIR, so the job runs with the same
# configuration. Never secrets: anything named like a key, token, secret or password is skipped
# (the Anthropic key comes from the Keychain and the Telegram token from the plugin, at run time).
extra_env() {
  local name
  while IFS= read -r name; do
    [[ "$name" == USAGE_INSIGHTS_* || "$name" == TELEGRAM_STATE_DIR ]] || continue
    [[ "$name" == USAGE_INSIGHTS_DATA_DIR ]] && continue
    [[ "$name" =~ (KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH) ]] && continue
    printf '    <key>%s</key>\n    <string>%s</string>\n' "$name" "$(xml_escape "${!name}")"
  done < <(compgen -e | LC_ALL=C sort)
}

render() {
  local line
  sed -e "s|__LABEL__|$(escape "$LABEL")|g" \
      -e "s|__SCRIPT__|$(escape "$SCRIPT")|g" \
      -e "s|__LOG__|$(escape "$LOG")|g" \
      -e "s|__BUN_DIR__|$(escape "$(dirname "$BUN")")|g" \
      -e "s|__BUN__|$(escape "$BUN")|g" \
      -e "s|__REPO__|$(escape "$REPO")|g" \
      -e "s|__DATA_DIR__|$(escape "$DATA_DIR")|g" \
      "$TEMPLATE" |
    while IFS= read -r line; do
      if [[ "$line" == "__SCHEDULE__" ]]; then printf '%s\n' "$SCHEDULE"
      elif [[ "$line" == "__EXTRA_ENV__" ]]; then extra_env
      else printf '%s\n' "$line"; fi
    done
}

if [[ $PRINT -eq 1 ]]; then render; exit 0; fi

mkdir -p "$DATA_DIR" "$HOME/Library/LaunchAgents"
render > "$PLIST"
plutil -lint "$PLIST" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL ($WHEN). Log: $DATA_DIR/$LOG"

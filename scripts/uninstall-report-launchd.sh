#!/usr/bin/env bash
# Stops and removes the weekly Report's launchd agent. Saved Reports are left in place.
set -euo pipefail

LABEL="dev.usage-insights.report"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Uninstalled $LABEL"

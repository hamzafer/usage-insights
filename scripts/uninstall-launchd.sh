#!/usr/bin/env bash
# Stops and removes the Recorder's launchd agent. Recorded data is left in place.
set -euo pipefail

LABEL="dev.usage-insights.recorder"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Uninstalled $LABEL"

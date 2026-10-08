#!/usr/bin/env bash
# Installs the Recorder's launchd agent (`bun run record` every 5 minutes). Thin wrapper.
# Usage: scripts/install-launchd.sh [--print] /path/to/usage-insights-checkout
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == "--print" ]]; then shift; exec "$SCRIPT_DIR/launchd.sh" install --print recorder "$@"; fi
exec "$SCRIPT_DIR/launchd.sh" install recorder "$@"

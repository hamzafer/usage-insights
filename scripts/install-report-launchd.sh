#!/usr/bin/env bash
# Installs the weekly Report's launchd agent (`bun run report` Mondays at 09:00). Thin wrapper.
# Usage: scripts/install-report-launchd.sh [--print] /path/to/usage-insights-checkout
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == "--print" ]]; then shift; exec "$SCRIPT_DIR/launchd.sh" install --print report "$@"; fi
exec "$SCRIPT_DIR/launchd.sh" install report "$@"

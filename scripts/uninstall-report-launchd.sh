#!/usr/bin/env bash
# Stops and removes the weekly Report's launchd agent. Saved Reports are left in place. Thin wrapper.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/launchd.sh" uninstall report

#!/usr/bin/env bash
# Stops and removes the Recorder's launchd agent. Recorded data is left in place. Thin wrapper.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/launchd.sh" uninstall recorder

# Usage Insights

Records how much of each AI subscription's allowance gets used over time, so the setup can be
tuned on evidence. Snapshots come from OpenUsage's
local API. Vocabulary: `GLOSSARY.md`. Decisions: `docs/adr/`.

## Requirements

- macOS, [Bun](https://bun.sh) 1.2+
- OpenUsage running (its local API on `127.0.0.1:6736`)

## Commands

```sh
bun install
bun run record   # one recording run: a Snapshot of every Provider, or a gap if OpenUsage is down
bun run status   # latest reading per Provider and line, plus recent gaps
bun test
bunx tsc --noEmit
```

## Data

Recorded data never lives in the repo (ADR 0002). It goes to
`~/Library/Application Support/usage-insights/` (`usage.db`, `recorder.log`).

| Variable | Default |
|---|---|
| `USAGE_INSIGHTS_DATA_DIR` | `~/Library/Application Support/usage-insights` |
| `USAGE_INSIGHTS_OPENUSAGE_URL` | `http://127.0.0.1:6736/v1/usage` |

## Background recording (launchd)

Install the Recorder to run every 5 minutes from your checkout:

```sh
scripts/install-launchd.sh "$PWD"
```

Add `--print` to see the generated plist without installing it. Output goes to
`recorder.log` in the data directory.

Uninstall (recorded data is kept):

```sh
scripts/uninstall-launchd.sh
```

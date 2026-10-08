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
bun run summary  # ended Cycles per Provider with their Waste ("low confidence" if readings were sparse)
bun run backfill:codex  # past Codex readings from ~/.codex/sessions (Measured); rerun anytime, reads only new lines
bun run backfill:tokens # tokens per Project and model from Claude Code (both accounts) and Codex logs; rerun anytime
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
| `USAGE_INSIGHTS_CODEX_DIR` | `~/.codex/sessions` |
| `USAGE_INSIGHTS_CLAUDE_DIR` | `~/.claude/projects` (Provider `claude`) |
| `USAGE_INSIGHTS_CLAUDE_WORK_DIR` | `~/.claude-work/projects` (Provider `claude-work`) |
| `USAGE_INSIGHTS_PORT` | `6740` (dashboard) |

## Dashboard

```sh
bun run dashboard   # then open http://127.0.0.1:6740
```

It listens on `127.0.0.1` only (ADR 0002) and reads the data directory on every page load, so
reload for new Snapshots. Pages:

- **Overview** (`/`): per Provider, the running Cycle's usage and Pace, the last Cycle's Waste,
  Limit Hits and Blocked Time over 28 days, Overage, and Waste of the last few Cycles.
- **History** (`/provider/<id>`): Waste per Cycle and per started Session over time, and Idle
  Capacity per Cycle.
- **Projects and models** (`/projects`): token share per Project (a git repository, worktrees
  and subfolders merged; shown by folder name only) and per model for each Provider's last Cycles.
  Cycles before the first recorded Reset are stepped back in weeks and marked "dates inferred".
- **Data health** (`/health`): last Snapshot per Provider, unclassified lines, recorder gaps and
  stretches without Snapshots.

Estimated values are marked `~` and hatched, low-confidence Waste is flagged, and time without
Snapshots is hatched as unknown, never drawn as zero. The same data is served as JSON under
`/api/overview`, `/api/provider/<id>`, `/api/projects` and `/api/health`.

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

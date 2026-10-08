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

## Weekly Report (Telegram)

```sh
bun run report             # Backfills, then build, save and send the Report
bun run report --dry-run   # print the message and the full Report; send and save nothing
bun run report --test      # prefix the message with "[TEST] "
```

A run first runs the Codex and token Backfills (a failure is logged and noted in the Report),
then builds the Report for the 7 days before now: final Waste of every Cycle that reset, Pace of
running Cycles, Limit Hits and Blocked Time, Overage, top Projects and models, the trend vs the
previous 4 weeks, and time without readings (shown as unknown, never as zero). The full Report is
saved as `reports/YYYY-MM-DD.md` in the data directory; a short plain-text message goes to
Telegram. If building fails, the message is "Usage Insights Report failed: <reason>".

Telegram reuses the bot of the Claude Code Telegram plugin. The token and chat id are read at
send time from its state directory and never copied into the repo, plists or logs:

| Variable | Default |
|---|---|
| `TELEGRAM_STATE_DIR` | `${CLAUDE_CONFIG_DIR:-~/.claude}/channels/telegram` |
| `TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN` in `.env` there |
| `USAGE_INSIGHTS_TELEGRAM_CHAT_ID` | `allowFrom[0]` in `access.json` there |

Only `sendMessage` is called (the plugin owns `getUpdates`).

Install it to run Mondays at 09:00 local time (a run missed while the Mac slept happens on wake):

```sh
scripts/install-report-launchd.sh "$PWD"   # add --print to see the plist without installing
```

Output goes to `report.log` in the data directory. Uninstall (saved Reports are kept):

```sh
scripts/uninstall-report-launchd.sh
```

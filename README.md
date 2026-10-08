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
bun run record   # one recording run: a Snapshot of every Provider (or a gap if OpenUsage is down), plus the Backfills once per hour
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
| `USAGE_INSIGHTS_PORT` | `6740` (dashboard; only the dashboard checks it) |

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
- **Data health** (`/health`): last Snapshot per Provider, unclassified lines, recorder gaps,
  failed Backfill and Report runs, and stretches without Snapshots.

Estimated values are marked `~` and hatched, low-confidence Waste is flagged, and time without
Snapshots is hatched as unknown, never drawn as zero. The same data is served as JSON under
`/api/overview`, `/api/provider/<id>`, `/api/projects` and `/api/health`.

## Background recording (launchd)

Install the Recorder to run every 5 minutes from your checkout:

```sh
scripts/install-launchd.sh "$PWD"
```

Add `--print` to see the generated plist without installing it. Output goes to
`recorder.log` in the data directory. Each run also starts the Codex and token Backfills at most
once per hour, so new log lines come in without running them by hand. Any failure (including a bad
configuration or an unopenable store) is logged and the run still exits 0, so launchd keeps
retrying every 5 minutes; Backfill failures show on the dashboard's data-health page.

Uninstall (recorded data is kept):

```sh
scripts/uninstall-launchd.sh
```

Both jobs (Recorder and Report) come from one template, `launchd/job.plist.template`, rendered by
`scripts/launchd.sh install [--print] <recorder|report> <checkout>` (`uninstall <job>` removes one);
the per-job scripts are thin wrappers around it.

## Weekly Report (Telegram)

```sh
bun run report             # Backfills, then build, save and send the Report
bun run report --dry-run   # print the card (HTML) and the full Report; no Backfill, writes and sends nothing
bun run report --test      # prefix the message with "[TEST] "
```

A run first runs the Codex and token Backfills (a failure is logged and noted in the Report),
then builds the Report for the 7 days before now: final Waste of every Cycle that reset, Pace of
running Cycles, Limit Hits and Blocked Time, Overage, top Projects and models, the trend vs the
previous 4 weeks, and time without readings (shown as unknown, never as zero). The full Report is
saved as `reports/YYYY-MM-DD.md` in the data directory; a compact card goes to Telegram (HTML
parse mode, under 4096 characters). If building fails, the message is "Usage Insights Report
failed: <reason>".

The card has four parts: **▶ Running now** (one line per running Cycle, worst first), **✅ Last
week** (Cycles that reset, Limit Hits and Overage), **💡 Suggestions** (each cut to about 140
characters; the Markdown keeps them whole) and **▸ Details** in an expandable quote (top Projects
and models, token trend, and either "Week N of recording" for the first 4 weeks or the time
without readings). Providers and models show display names ("Claude (Work)", "Opus 5.5").

Status dots in Running now:

| Dot | Rule |
|---|---|
| 🟢 | heading for under 30% Waste, or on pace to max out in the last 10% of the Cycle (using it all) |
| 🟡 | heading for 30–70% Waste, or on pace to max out with 10–30% of the Cycle left |
| 🔴 | heading for over 70% Waste, or on pace to max out with over 30% of the Cycle left |
| ⚪ | no rate yet (needs more readings) |

Pace is anchored at the Cycle's start (usage 0 at the Reset minus the Window length) when the
length is known, so one late spike does not project a Limit Hit tomorrow.

Telegram reuses the bot of the Claude Code Telegram plugin. The token and chat id are read at
send time from its state directory and never copied into the repo, plists or logs:

| Variable | Default |
|---|---|
| `TELEGRAM_STATE_DIR` | `${CLAUDE_CONFIG_DIR:-~/.claude}/channels/telegram` |
| `TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN` in `.env` there |
| `USAGE_INSIGHTS_TELEGRAM_CHAT_ID` | `allowFrom[0]` in `access.json` there |

Only `sendMessage` is called (the plugin owns `getUpdates`).

### Suggestions and the Setup file

The Report ends with up to 3 Suggestions written by Claude (Sonnet 5.5) from the week's numbers
and your Setup file, `setup.md` in the data directory (see `docs/setup.example.md`). Only the
numbers section is sent: no log content, Projects by folder name only. If the call fails, the
Report still goes out with "Suggestions unavailable: <reason>".

```sh
bun run setup:draft   # write a DRAFT setup.md if there is none (a real Report run does this too)
```

Reports say "Setup is a DRAFT" until you remove DRAFT from the file's first line.

| Variable | Default |
|---|---|
| `ANTHROPIC_API_KEY` | Keychain item `anthropic-api-key-personal` (read at call time, never logged) |
| `USAGE_INSIGHTS_CLAUDE_MODEL` | `claude-sonnet-5-5` |
| `USAGE_INSIGHTS_ANTHROPIC_URL` | `https://api.anthropic.com/v1/messages` |

Install it to run Mondays at 09:00 local time (a run missed while the Mac slept happens on wake):

```sh
scripts/install-report-launchd.sh "$PWD"   # add --print to see the plist without installing
```

Output goes to `report.log` in the data directory. Uninstall (saved Reports are kept):

```sh
scripts/uninstall-report-launchd.sh
```

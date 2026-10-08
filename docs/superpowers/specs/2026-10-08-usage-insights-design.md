# Usage Insights: design

Status: draft for review (2026-10-08). Vocabulary follows `GLOSSARY.md`; decisions in `docs/adr/`.

## Goal

Record how each **Provider**'s allowance is used over time and turn it into **Waste**, **Idle
Capacity**, **Limit Hits**, **Overage** and **Pace**, shown on a local dashboard and in a Monday
**Report** with Claude-written **Suggestions**, so the **Setup** can be tuned on evidence.

## Non-goals (for now)

- Own logins per **Provider** (ADR 0001: only if depending on OpenUsage starts to hurt).
- Hosting the dashboard (local first; hosting later only behind login, ADR 0002).
- Changing the **Setup** automatically. **Suggestions** advise, the user decides.
- Copilot and Cursor **Backfill** beyond what their sources give (Copilot: none; Cursor: rough
  Sep to Dec 2025 token counts, out of scope for v1).

## Stack

- **TypeScript on Bun** (1.2+): `bun:sqlite` for storage, `Bun.serve` for the dashboard,
  `bun test` for tests. No runtime dependencies beyond Bun.
- **launchd** agents for the timers (recorder every 5 min, Report Mondays).
- **Data directory**: `~/Library/Application Support/usage-insights/` holds `usage.db`,
  `setup.md` (the **Setup** file) and generated reports. Never inside the repo (ADR 0002).

## Architecture

Six units, each with one job and a narrow interface. Data flows one way:

```
OpenUsage API ─► Recorder ─► snapshots ─┐
Codex logs ────► Codex Backfill ────────┤
Claude logs ───► Claude Backfill ───────┼─► Window Model ─► Dashboard
                                        │                └► Report ─► Claude (Suggestions) ─► Telegram
                                        └─ (usage.db)
```

### 1. Snapshot source (seam) and Recorder

- `SnapshotSource` interface: `fetch(): Promise<ProviderReading[]>`. The only implementation for
  now reads `GET http://127.0.0.1:6736/v1/usage` (ADR 0001). Swapping in own logins later means a
  new implementation, nothing else changes.
- The Recorder runs every 5 minutes (launchd `StartInterval 300`), fetches, and stores one row per
  **progress** line per **Provider**: `provider, label, used, limit, unit, resetsAt, periodMs,
  plan, fetchedAt, recordedAt`. Text and chart lines are ignored.
- If OpenUsage is unreachable it records a **gap marker** (`recordedAt`, reason) instead of
  nothing, so gaps are visible (ADR 0001).
- Idempotent: the same `(provider, label, fetchedAt)` is never stored twice.

### 2. Line classification

Each progress line maps to a domain role. Mapping table in code, covering today's cards:

| Provider | Line | Role |
|---|---|---|
| Claude, Claude (Work), Codex | Session | **Session** |
| Claude, Claude (Work), Codex | Weekly | **Cycle** |
| Cursor | Total usage | **Cycle** (dollars) |
| Copilot | Premium | **Cycle** |
| Claude (Work) | Extra usage spent | **Overage** ($) |
| Cursor | On-demand | **Overage** ($) |
| Codex | Workspace Credits | **Overage** (credits) |
| Cursor | Auto usage, API usage | sub-meters, stored but not analysed in v1 |
| Copilot | Chat | ignored when unlimited |

Unknown lines are stored and listed as "unclassified" on the dashboard, never silently dropped.

### 3. Window Model (pure functions, the core)

Turns stored readings into **Windows** and their results. No I/O, fully unit-tested.

- **Window identity**: `(provider, role, resetsAt)`, with `resetsAt` rounded to the minute
  (OpenUsage adds millisecond jitter, and Codex can drift by seconds).
- **Reset detection**: a Window ends when the next reading has a later `resetsAt`, or `used`
  drops back near zero.
- **Waste** of an ended Window = `1 - lastUsed/limit` from the last reading before the Reset.
  If the last reading is older than 30 minutes before the Reset, the result is flagged
  "low confidence" (usage may have happened in the gap).
- **Session started?** A Session with no usage and no `resetsAt` never started: no Waste.
  **Idle Capacity** = Cycle time not covered by any started Session.
- **Limit Hit**: `used >= limit`. **Blocked Time** runs from the first reading at the limit to
  the Reset (or until **Overage** starts growing, which means the user kept working on paid usage).
- **Pace** for a running Cycle: linear projection of `used` to `resetsAt` from the Cycle's
  readings so far, giving the expected Waste.
- Every figure carries `Measured` or `Estimated`; the two are never combined.

### 4. Backfill

- **Codex** (Measured): `~/.codex/sessions/**/rollout-*.jsonl` back to Sep 2025. `event_msg`
  lines of type `token_count` carry `rate_limits` (used % and reset per window), so past
  Sessions and Cycles get real Waste and Limit Hits. Tokens per model come from the same lines
  plus `turn_context` (model). Readings are written as Snapshots with `source = backfill:codex`.
- **Claude** (Estimated): `~/.claude/projects` (since Mar 2026) and `~/.claude-work/projects`
  (since Aug 2026). Logs carry tokens and model, not percent. Dedupe on `message.id` /
  `requestId`. A **calibration** learned from live Snapshots ("tokens per 1% of a Session /
  Cycle", per account and model mix) converts past tokens into `~` Waste. Calibration is
  recomputed as new Snapshots arrive; until there is enough data, Claude Backfill shows tokens
  only.
- **Project**: each log entry's `cwd` is resolved to its git repository root (worktrees and
  subfolders merge into one **Project**). Unresolvable paths group as "(other)".
- Backfill is rerunnable and incremental (it remembers the last file and offset read).

### 5. Dashboard (local)

- `Bun.serve` on `localhost:6740`, started on demand (`bun run dashboard`) or by launchd.
- Pages: overview (per **Provider**: last Cycles' Waste, current Pace, Limit Hits, Overage);
  per-Provider history (Waste per Cycle and Session over time); **Projects** and models
  (token share per Cycle); data health (gaps, unclassified lines, calibration state).
- Charts follow the repo's dataviz guidance; Estimated values are visibly marked `~`.

### 6. Report, Suggestions, Telegram

- launchd runs it Mondays at 09:00 local time.
- Content (per `GLOSSARY.md`): final Waste for every Cycle that reset in the past 7 days, Pace for
  running Cycles, Limit Hits and Blocked Time, Overage, top Projects and models, trends vs the
  previous 4 weeks.
- **Suggestions**: the computed numbers plus `setup.md` go to Claude using the personal API key
  (`anthropic-api-key-personal` in Keychain). Prompt asks for at most 3 concrete Suggestions that
  reference the Setup. The numbers section is generated without Claude, so the Report still goes
  out if the API call fails (the Suggestions section then says so).
- **Telegram**: sent via the Bot API with the existing bot; a short message with the headline
  numbers and Suggestions, plus the full Report saved as Markdown in the data directory.

## Error handling

- Every failure is loud in a log file in the data directory and visible on the dashboard's
  data-health page; nothing is silently zero-filled.
- Recorder failures never crash launchd loops; the next run retries.
- Report sends a short "Report failed: <reason>" Telegram message if building it fails.

## Testing

- **Window Model**: unit tests on hand-built reading sequences (normal Cycle, Reset detection with
  jitter, Limit Hit then Overage, unstarted Session, gaps, low-confidence Waste, Pace).
- **Recorder**: test against a recorded fixture of the real `/v1/usage` response (secrets-free).
- **Backfill**: fixture JSONL files for Codex and Claude (synthetic, no real content), covering
  duplicates, missing `info`, worktree paths.
- **Report**: snapshot test of the numbers section; Claude and Telegram behind interfaces with
  fakes in tests.

## Build order

1. **Recorder** + storage + line classification. Ship first so history starts collecting.
2. **Window Model** + a CLI summary (`bun run summary`).
3. **Codex Backfill**.
4. **Dashboard** (overview + history).
5. **Claude Backfill** + calibration + **Project** and model breakdown.
6. **Report** + Suggestions + Telegram.

## Open points for the implementation plan

- Exact field names of Codex `rate_limits` (verify on real files before writing the parser).
- Claude model ID for Suggestions: pick at plan time from current docs, not memory.
- Telegram bot token location and chat ID (reuse the existing bot config without copying the
  token into the repo).

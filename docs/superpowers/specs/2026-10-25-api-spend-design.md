# API Spend: design

Status: the user picked this option on 2026-10-25 ("ship option 3"); the details below are Claude's
defaults, made under a `/goal`. Vocabulary: `GLOSSARY.md` (**API Spend**, **Key**, **Caller**).
Decision: ADR 0004.

## Goal

Show what each Anthropic API **Key** (personal, work) costs, split by the **Caller** that spent it,
on the dashboard and in the weekly Report. Today the only place to see it is the Anthropic Console.

## Why not the Console's numbers

Spend per key comes from the Admin API's usage and cost reports, which need an admin key; the
personal account is an individual account and gets 403 (ADR 0004). So the Callers report their own
usage: every Messages API reply carries a `usage` object.

## Callers today

| Caller | Where | Key | Model | What it records |
|---|---|---|---|---|
| **Suggestions** | this repo, `src/report/anthropic-client.ts` | `anthropic-api-key-personal` (or `ANTHROPIC_API_KEY`) | `claude-sonnet-5-5` | nothing yet |
| **Bouncer** | reason-bridge (`~/developer/ai/playground/reason-bridge`), the auto-mode judge | Keychain service from `~/.config/reason-bridge/mode.json` `key_service`, default `anthropic-api-key-personal` | `claude-haiku-5-5` (its `Model` constant) | today's totals in `~/.config/reason-bridge/judge-usage.json` |

The work key (`anthropic-api-key-work`) has no Caller on this Mac; it shows as "no calls".

## Data

New migration (append to `MIGRATIONS` in `src/store.ts`):

```sql
CREATE TABLE api_spend (
  day         TEXT NOT NULL,      -- local date, YYYY-MM-DD
  key         TEXT NOT NULL,      -- Key name: 'personal', 'work', or 'env' (ANTHROPIC_API_KEY)
  caller      TEXT NOT NULL,      -- 'suggestions', 'bouncer'
  model       TEXT NOT NULL,
  calls       INTEGER NOT NULL,
  input       INTEGER NOT NULL,   -- uncached input tokens
  cache_write INTEGER NOT NULL,
  cache_read  INTEGER NOT NULL,
  output      INTEGER NOT NULL,
  cost_usd    REAL,               -- NULL: the model has no known price
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (day, key, caller, model)
);
```

Store methods:

- `addApiSpend(row)`: adds to the day's row (one call by this repo's own client).
- `setApiSpend(row)`: replaces the day's row (a Caller that keeps its own daily totals, the Bouncer).
- `apiSpend(range?: { from?: string; to?: string })`: rows with `day` in range (inclusive).

**Key name** from a Keychain service: `anthropic-api-key-<name>` → `<name>`; any other service is
kept as given.

## Prices

`src/api-prices.ts`: USD per million tokens, from the claude-api skill (cached 2026-10-06):

| Model | Input | Output | Cache read | Cache write (5 min) |
|---|---|---|---|---|
| `claude-opus-5-5` | 4.00 | 20.00 | 0.20 | 1.25 × input |
| `claude-sonnet-5-5` | 2.00 | 10.00 | 0.20 | 1.25 × input |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 | 1.25 × input |

1-hour cache writes cost 2 × input (from `usage.cache_creation.ephemeral_1h_input_tokens` when
present). Haiku 5.5 prompts above 100K tokens cost more; the Callers stay far below that, so it is
not modelled. An unknown model stores tokens with `cost_usd` NULL, shown as "?".

## Recording

1. **Suggestions:** `AnthropicClient` gets an optional `onUsage(usage)` hook called after every
   successful reply (both the Suggestions call and the shorten call), with the model and token
   counts. The Report run wires it to `store.addApiSpend` with caller `suggestions` and the Key name
   (`env` when `ANTHROPIC_API_KEY` was used, else the Keychain service's name). Dry runs (read-only
   store) record nothing. Recording failures are logged and never fail the Report.
2. **Bouncer:** every Recorder run (5 min) reads `judge-usage.json` and `mode.json` from the
   reason-bridge config dir (`USAGE_INSIGHTS_REASON_BRIDGE_DIR`, default `~/.config/reason-bridge`)
   and calls `setApiSpend` for the file's `date` with its `calls`, `input_tokens`, `output_tokens`
   and `cost_usd` (the Bouncer's own figure, already priced). A missing file records nothing; a
   damaged one is logged; neither stores a gap or fails the run. The file holds only today, so calls
   in the last minutes before midnight after the final read are lost (at most 5 minutes a day).

## Showing it

- **API:** `GET /api/api-spend` → `{ keys: KeySpend[] }`, one entry per Key in
  `["personal", "work"]` plus any other Key with rows, each with `last7d` and `last30d` cost and
  calls, per-Caller rows (caller, model, `last7d`, `last30d`), and `daily` (last 30 days, a cost per
  day; days without rows are 0, because no calls means no spend).
- **Overview:** a "Claude API" section under the Last week row: one compact row per Key (name,
  7-day and 30-day cost, calls), Callers listed under it with their model, "no calls" for a Key
  without rows. A footnote: "Only calls from your own tools. The Anthropic Console shows every key."
  Same card style as the rest of the page (shadcn Card, Geist Mono numbers, no new colors).
- **Report:** one line in the Telegram card's Last week section and the Markdown Report:
  `🔑 Claude API: $0.04 (personal: Bouncer $0.03, Suggestions $0.01; work: no calls)`.
  Money under one cent shows as `<$0.01`.

## Out of scope

- The Admin API, the Console's numbers, keys used on other machines (ADR 0004).
- Suggestions about API Spend (the Suggestions prompt is unchanged).

## Testing

Test-first with `bun test`: store migration and methods, prices (cache writes, unknown model),
the client's `onUsage` hook (fake fetch), the Bouncer import (temp dir: missing, damaged, normal,
custom `key_service`), the view model and endpoint, the Report line, and the web component's pure
logic in `web/lib/`. Screenshots from sample data only.

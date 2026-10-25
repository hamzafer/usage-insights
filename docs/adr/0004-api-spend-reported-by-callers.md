# API Spend is reported by the Callers, not read from Anthropic

**API Spend** per **Key** is recorded from the `usage` object of each Messages API reply that my own
tools (the **Callers**) receive, priced with a local price table, instead of read from Anthropic's
usage and cost reports. Those reports need an Admin API key, which an individual account cannot
create (the personal account gets 403 on `usage_report` and `cost_report`).

## Consequences

- Only calls made by known Callers on this Mac are counted. A Key used anywhere else (another
  machine, a deployed app, a leaked key) never shows up here; the Anthropic Console stays the source
  of truth for the bill.
- Prices are kept in the repo and go stale when Anthropic changes them; an unknown model is shown
  as "?" rather than guessed.
- If the account ever gets Admin API access, the reports can replace or check this. Keep the
  recording behind the store methods so that swap stays cheap.

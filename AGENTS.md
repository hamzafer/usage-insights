# Usage Insights

Records how much of each AI subscription's allowance gets used over time and turns it
into Waste, Limit Hits, Overage and Pace. Vocabulary: `GLOSSARY.md`. Decisions: `docs/adr/`.
Design: `docs/superpowers/specs/2026-10-08-usage-insights-design.md`.

## Layout

- `src/`: Recorder, Backfills, Report and the dashboard's JSON API (`src/dashboard/server.ts`,
  view models in `src/dashboard/*.ts`; no HTML is rendered on the server).
- `web/`: the dashboard app (Next.js static export, ADR 0003; read `web/AGENTS.md` first).
  Pure UI logic lives in `web/lib/` with `bun test` tests; components in `web/components/`.
- Screenshots in `docs/images/` come from sample data only (fake projects and models), never a
  real data directory.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for hamzafer/usage-insights (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

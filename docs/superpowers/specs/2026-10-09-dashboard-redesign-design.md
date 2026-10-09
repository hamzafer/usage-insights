# Dashboard redesign: design

Status: approved by the user on 2026-10-09 ("ship this"). Vocabulary: `GLOSSARY.md`. Decisions:
`docs/adr/` (0003 for the frontend architecture).

## Goal

Replace the hand-built HTML dashboard with a polished one in the style the user pointed to (Vercel
Analytics, X developer console, ChatGPT usage analytics): KPI tiles, one hero chart, ranked lists,
multi-line and stacked charts, and a sessions table. The data model, recorder and Report do not
change; the new frontend reads the existing JSON API plus a few new endpoints.

## Decisions (from the user)

- **Look:** a mix: Vercel-style Overview (KPI tiles + hero chart), ChatGPT-style Analytics
  (tabs, range toggles, stacked bars with big % legends, multi-line charts, a top-sessions table).
- **Theme:** dark by default, light toggle, follows the system until toggled.
- **Accent:** electric blue, used sparingly (selected tab, hero line, focus ring).
- **Hero:** the selected plan's current **Cycle**: % used over time, dashed **Pace** projection to the
  **Reset**, a 100% limit line.
- **Analytics sections:** Projects and models lists, tokens by model over time, **Waste** and
  **Limit Hit** history, top sessions.
- **Stack:** Next.js + shadcn/ui (new-york, zinc) + shadcn charts (Recharts), Geist Sans and Geist
  Mono (numbers).

## Architecture

- New `web/` folder: a Next.js app (App Router, TypeScript, Tailwind v4, shadcn/ui), built as a
  **static export** (ADR 0003). Data is fetched client-side from the JSON API.
- The existing Bun server (`bun run dashboard`, `127.0.0.1:6740`, local-only Host check) serves the
  exported files and the API: one process, one port. `bun run dashboard` builds the export when it
  is missing or stale.
- Development: `next dev` with a rewrite of `/api/*` to the Bun server.
- The old server-rendered pages (`src/dashboard/render.ts`, `charts.ts`) are removed at the end;
  their view models stay where the new API reuses them.

## Pages

```
Usage Insights            ( Overview ) ( Analytics )      ● recording   [◐]
```

**Overview**
- **Plan tiles**, one per **Provider**: current Cycle % used, status dot (same thresholds as the
  Telegram card), a short Pace line ("~43% waste ahead" / "max out Tue"), delta vs the last Cycle.
  Clicking a tile selects the hero plan.
- **Hero chart**: % used through the current Cycle for the selected plan (solid area), Pace as a
  dashed line to the Reset, a 100% limit line, gaps shown as breaks (never zero). Crosshair + tooltip.
- **Last week line**: Cycles that reset, Limit Hits, **Overage**, in one quiet row.

**Analytics** (range toggle 7d / 30d where it applies)
- **Projects** and **Models**: ranked lists with a proportional bar behind each row, tabs per
  Provider that has logs (Claude, Claude (Work), Codex).
- **Tokens by model**: one line per model per day; ≥ 9 models fold into "Other".
- **Waste and Limit history**: per plan, one stacked bar per Cycle (used vs wasted), Limit Hits
  marked; Estimated values hatched and marked `~`, low confidence faded.
- **Top sessions**: the biggest sessions in the range with tokens, % of the 5-hour limit and % of
  the weekly limit. Codex: Measured from its logs' rate limits. Claude: tokens only until the
  calibration is ready, then `~` estimates.

**Data health**: a status pill in the header ("● recording" / "● 2 gaps today" / "● run failed")
opens a sheet with the current data-health content.

## Visual system

- shadcn tokens only for surfaces and text (`bg-background`, `bg-card`, `text-muted-foreground`, …).
- One categorical color per Provider in fixed order, validated with the dataviz validator against
  both the light and dark chart surfaces; status colors (good / warning / serious) are separate and
  always come with a label.
- Dataviz rules: thin marks, 2px lines, a legend for ≥ 2 series, hover tooltips on every chart, a
  table view for each chart, one y-axis per chart.
- Responsive down to phone width; visible keyboard focus; reduced motion respected.

## New API

- `GET /api/hero/:provider`: the current Cycle's readings (time, used %), Pace projection, Reset,
  limit, gaps.
- `GET /api/tokens/daily?range=7d|30d`: tokens per day per model (and per Provider).
- `GET /api/projects?range=7d|30d`: Projects and models for a range (extends the current endpoint).
- `GET /api/history/:provider`: Waste per Cycle with basis and confidence, plus Limit Hits.
- `GET /api/sessions/top?range=7d|30d`: top sessions. Needs a session id on token events: a new
  append-only migration plus a re-read of the logs.

## Testing

- API: handler tests with a temp data dir (as today).
- Frontend: typecheck and lint in CI; component logic (formatting, status dot, folding to Other)
  as pure functions with `bun test`; a build of the static export in CI.
- Visual: screenshots of Overview and Analytics in dark and light, from sample data, checked
  before merge and added to the README.

## Out of scope

- Hosting on Vercel (stays possible: ADR 0002 says behind a login).
- Changing what the recorder or Report computes.

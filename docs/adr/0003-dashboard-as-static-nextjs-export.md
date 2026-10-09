# Dashboard is a static Next.js export served by the Bun server

The dashboard UI is a Next.js + shadcn/ui app in `web/`, built as a static export and served,
together with the JSON API, by the existing Bun server on `127.0.0.1:6740`. We chose this over a
Next.js server (a second long-running process and port) and over keeping hand-built SVG (hard to
reach the polish of the reference dashboards). Data stays local and the API stays the single seam;
hosting on Vercel later (ADR 0002: behind a login) means deploying the same app with the API
behind it, not a rewrite.

## Consequences

- The UI fetches everything client-side from `/api/*`; no server-side rendering of private data.
- The repo gains a Node toolchain for `web/` (Next.js, Tailwind, Recharts). The recorder, backfills
  and Report keep their zero-dependency Bun runtime.

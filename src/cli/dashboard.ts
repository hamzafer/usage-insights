// The local dashboard (`bun run dashboard`): overview, per-Provider history and data health.
// Bound to 127.0.0.1 only (ADR 0002: local for now; hosting later only behind a login).
import { mkdirSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { loadDashboardData } from "../dashboard/data.ts";
import { dashboardHandler } from "../dashboard/server.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.dashboardPort,
  fetch: dashboardHandler({ load: () => loadDashboardData(config.dbPath) }),
});

console.log(`Usage Insights dashboard on http://127.0.0.1:${server.port}`);

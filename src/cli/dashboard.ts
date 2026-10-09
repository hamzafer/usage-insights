// The local dashboard (`bun run dashboard`): the app in web/ (a static export, ADR 0003) and the
// JSON API on one port, bound to 127.0.0.1 only (ADR 0002: local for now; hosting later only behind
// a login). Builds the export first when it is missing or older than web/'s sources; `--no-build`
// skips that and serves whatever export exists (the old pages at / when there is none).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dashboardPort, loadConfig } from "../config.ts";
import { loadDashboardData } from "../dashboard/data.ts";
import { dashboardHandler } from "../dashboard/server.ts";
import { buildExport, isExportStale } from "../dashboard/web-build.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const webDir = join(import.meta.dir, "..", "..", "web");
const staticDir = join(webDir, "out");
if (!process.argv.includes("--no-build") && isExportStale(webDir)) {
  const failed = buildExport(webDir);
  if (failed) console.error(`dashboard: could not build the app (${failed}); serving the last export or the old pages.`);
}

const port = dashboardPort();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  // `port` also limits the Host header to 127.0.0.1 or localhost at this port (DNS rebinding).
  fetch: dashboardHandler({ load: () => loadDashboardData(config.dbPath), port, staticDir }),
});

console.log(`Usage Insights dashboard on http://127.0.0.1:${server.port}`);

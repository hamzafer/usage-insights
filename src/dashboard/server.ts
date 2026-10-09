import { renderHealth, renderHistory, renderMessage, renderOverview, renderProjects, type PageContext } from "./render.ts";
import { hasExport, serveStatic, staticNotFound } from "./static.ts";
import { buildTokensDaily, isTokenRange } from "./tokens-daily.ts";
import { buildHealth, buildHistory, buildOverview, buildProjects, type DashboardData } from "./view-model.ts";

/**
 * The dashboard's request handler: the app's static export (`web/out`, ADR 0003) plus the JSON API.
 * The old server-rendered pages stay at /legacy, /health, /projects and /provider/:id until the
 * new app covers them (and at / while no export is built).
 * It only knows a `load` function, so serving it elsewhere (behind a login, ADR 0002) swaps the
 * data source and the listener, not the pages.
 */
export interface DashboardDeps {
  load: () => DashboardData;
  now?: () => Date;
  /** IANA time zone for times on the pages; the machine's local zone when omitted. */
  timeZone?: string;
  /** Where load failures are reported (stderr by default). */
  log?: (message: string) => void;
  /** The port it listens on; when given, only `localhost` or `127.0.0.1` at this port are served. */
  port?: number;
  /** The app's static export folder (`web/out`); without a built export, / shows the old overview. */
  staticDir?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Guards against DNS rebinding: a web page on another site whose name resolves to 127.0.0.1
 * sends its own name as Host, so only the local names (at the dashboard's port) are served.
 */
function isLocalHost(host: string, port: number | undefined): boolean {
  const match = /^([^:]+)(?::(\d+))?$/.exec(host.toLowerCase());
  if (!match || !LOCAL_HOSTS.has(match[1]!)) return false;
  return port === undefined || Number(match[2] ?? 80) === port;
}

export function dashboardHandler(deps: DashboardDeps): (req: Request) => Response {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.error(m));

  return (req) => {
    const url = new URL(req.url);
    const at = now();
    const ctxBase = { timeZone: deps.timeZone, now: at.toISOString() };
    if (!isLocalHost(req.headers.get("host") ?? url.host, deps.port)) {
      return new Response("Forbidden: open the dashboard at 127.0.0.1 or localhost", { status: 403 });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";
    const api = path === "/api" || path.startsWith("/api/");
    if (!api && !isLegacyPage(path) && hasExport(deps.staticDir)) {
      return (
        serveStatic(deps.staticDir, url.pathname, req.method) ??
        staticNotFound(deps.staticDir, req.method) ??
        new Response("Not found", { status: 404 })
      );
    }

    let data: DashboardData;
    try {
      data = deps.load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`dashboard: could not read the data: ${message}`);
      return html(renderMessage("Could not read the data", message, { ...ctxBase, providers: [] }), 500);
    }

    const overview = () => buildOverview(data, at);
    const providers = overview().map((p) => p.provider);
    const ctx: PageContext = { ...ctxBase, providers };
    const provider = /^\/(?:api\/)?provider\/([^/]+)$/.exec(path)?.[1];

    if (path === "/" || path === "/legacy") return html(renderOverview(overview(), buildHealth(data, at), ctx));
    if (path === "/health") return html(renderHealth(buildHealth(data, at), ctx));
    if (path === "/api/overview") return json({ now: ctx.now, providers: overview() });
    if (path === "/api/health") return json(buildHealth(data, at));
    if (path === "/projects") return html(renderProjects(buildProjects(data, at), ctx));
    if (path === "/api/projects") return json(buildProjects(data, at));
    if (path === "/api/tokens/daily") {
      const range = url.searchParams.get("range") ?? "7d";
      if (!isTokenRange(range)) return json({ error: "range must be 7d or 30d" }, 400);
      return json(buildTokensDaily(data.tokens ?? [], range, at, deps.timeZone));
    }
    if (provider !== undefined) {
      const id = decodePathPart(provider);
      const history = id === null ? null : buildHistory(data, id, at);
      if (!history) {
        return api
          ? json({ error: "No data for this Provider" }, 404)
          : html(renderMessage("No data for this Provider", "Nothing has been recorded for it yet.", ctx), 404);
      }
      return api ? json(history) : html(renderHistory(history, ctx));
    }
    return api
      ? json({ error: "Not found" }, 404)
      : html(renderMessage("Page not found", "Pick a page from the navigation above.", ctx), 404);
  };
}

/** The old server-rendered pages, removed once the new app covers them (#22). */
function isLegacyPage(path: string): boolean {
  return path === "/legacy" || path === "/health" || path === "/projects" || path.startsWith("/provider/");
}

/** A decoded path segment; null when it is not valid percent-encoding. */
function decodePathPart(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

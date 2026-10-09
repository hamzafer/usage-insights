import { claudeCalibration } from "../calibration.ts";
import { DEFAULT_TOP_SESSIONS, MAX_TOP_SESSIONS, TOP_SESSION_RANGES, type TopSessionRange, topSessions } from "../top-sessions.ts";
import { buildHero } from "./hero.ts";
import { renderHealth, renderHistory, renderMessage, renderOverview, renderProjects, type PageContext } from "./render.ts";
import { hasExport, serveStatic, staticNotFound } from "./static.ts";
import { buildProjectsRange, isProjectsRange } from "./projects-range.ts";
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
    if (path === "/api/tokens/daily") {
      const range = url.searchParams.get("range") ?? "7d";
      if (!isTokenRange(range)) return json({ error: "range must be 7d or 30d" }, 400);
      return json(buildTokensDaily(data.tokens ?? [], range, at, deps.timeZone));
    }
    if (path === "/api/projects") {
      // Without `?range=` it keeps the per-Cycle shape the old /projects page uses.
      const range = url.searchParams.get("range");
      if (range === null) return json(buildProjects(data, at));
      if (!isProjectsRange(range)) return json({ error: "range must be 7d or 30d" }, 400);
      return json(buildProjectsRange(data, at, range));
    }
    if (path === "/api/sessions/top") return sessionsTop(data, url.searchParams, at);
    const hero = /^\/api\/hero\/([^/]+)$/.exec(path)?.[1];
    if (hero !== undefined) {
      const id = decodePathPart(hero);
      const result = id === null ? null : buildHero(data, id, at, url.searchParams.get("label") ?? undefined);
      return result ? json(result) : json({ error: "No Cycle recorded for this Provider" }, 404);
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

/** `GET /api/sessions/top?range=7d|30d&limit=10`: the range's biggest sessions (ticket #21). */
function sessionsTop(data: DashboardData, params: URLSearchParams, at: Date): Response {
  const range = params.get("range") ?? "7d";
  if (!Object.hasOwn(TOP_SESSION_RANGES, range)) return json({ error: "range must be 7d or 30d" }, 400);
  const limitParam = params.get("limit");
  const limit = limitParam === null ? DEFAULT_TOP_SESSIONS : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TOP_SESSIONS) {
    return json({ error: `limit must be a whole number from 1 to ${MAX_TOP_SESSIONS}` }, 400);
  }
  const { calibrations } = claudeCalibration(data.readings, data.tokens ?? [], at);
  const sessions = topSessions({
    events: data.sessionTokens ?? [],
    readings: data.readings,
    calibrations,
    now: at,
    range: range as TopSessionRange,
    limit,
  });
  return json({ now: at.toISOString(), range, sessions });
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

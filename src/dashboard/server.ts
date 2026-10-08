import { renderHealth, renderHistory, renderMessage, renderOverview, type PageContext } from "./render.ts";
import { buildHealth, buildHistory, buildOverview, type DashboardData } from "./view-model.ts";

/**
 * The dashboard's request handler: routes to view models, rendered as HTML or JSON.
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
}

export function dashboardHandler(deps: DashboardDeps): (req: Request) => Response {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.error(m));

  return (req) => {
    const url = new URL(req.url);
    const at = now();
    const ctxBase = { timeZone: deps.timeZone, now: at.toISOString() };
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
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
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const provider = /^\/(?:api\/)?provider\/([^/]+)$/.exec(path)?.[1];

    if (path === "/") return html(renderOverview(overview(), buildHealth(data, at), ctx));
    if (path === "/health") return html(renderHealth(buildHealth(data, at), ctx));
    if (path === "/api/overview") return json({ now: ctx.now, providers: overview() });
    if (path === "/api/health") return json(buildHealth(data, at));
    if (provider !== undefined) {
      const history = buildHistory(data, decodeURIComponent(provider), at);
      const api = path.startsWith("/api/");
      if (!history) {
        return api
          ? json({ error: "No data for this Provider" }, 404)
          : html(renderMessage("No data for this Provider", "Nothing has been recorded for it yet.", ctx), 404);
      }
      return api ? json(history) : html(renderHistory(history, ctx));
    }
    return path.startsWith("/api/")
      ? json({ error: "Not found" }, 404)
      : html(renderMessage("Page not found", "Pick a page from the navigation above.", ctx), 404);
  };
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

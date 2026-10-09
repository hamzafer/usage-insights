import type { Overview, TopSessions } from "./types";

/**
 * The JSON API client. Same origin: in production the Bun server serves the app and `/api/*`; in
 * `next dev` a rewrite proxies `/api/*` to it (next.config.ts). Add one function per endpoint.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    /** "offline": the dashboard server did not answer; "http": it answered with an error status. */
    readonly kind: "offline" | "http",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new ApiError("The dashboard server is not answering.", "offline");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `The server answered ${res.status}.`, "http", res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  overview: (init?: RequestInit) => getJson<Overview>("/api/overview", init),
  topSessions: (range: string, init?: RequestInit) =>
    getJson<TopSessions>(`/api/sessions/top?range=${encodeURIComponent(range)}`, init),
};

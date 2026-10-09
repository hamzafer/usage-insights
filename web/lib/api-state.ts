import type { ApiError } from "./api";

/** What a section shows for one API resource. */
export type ApiState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "error"; data?: undefined; error: ApiError }
  | { status: "ready"; data: T; error?: undefined };

/** A finished request, tagged with the loader it answered (one per tab, range or provider). */
export interface Settled<T> {
  source: unknown;
  state: Exclude<ApiState<T>, { status: "loading" }>;
}

export function settled<T>(source: unknown, state: Settled<T>["state"]): Settled<T> {
  return { source, state };
}

/**
 * The state to render for the current loader. A result from another loader (the previous tab or
 * range) is never shown under the new one's label: until the new request lands, it is "loading".
 */
export function visibleState<T>(last: Settled<T> | null, source: unknown): ApiState<T> {
  return last && last.source === source ? last.state : { status: "loading" };
}

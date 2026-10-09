"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

export type ApiState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "error"; data?: undefined; error: ApiError }
  | { status: "ready"; data: T; error?: undefined };

/**
 * Loads one API resource on mount; `reload` fetches again. `load` must be stable (a function from
 * `api` in lib/api.ts, or one wrapped in useCallback).
 */
export function useApi<T>(load: (init?: RequestInit) => Promise<T>): ApiState<T> & { reload: () => void } {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal }).then(
      (data) => setState({ status: "ready", data }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error: err instanceof ApiError ? err : new ApiError(String(err), "http"),
        });
      },
    );
    return () => controller.abort();
  }, [load, attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, reload };
}

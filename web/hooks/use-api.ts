"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { type ApiState, type Settled, settled, visibleState } from "@/lib/api-state";

export type { ApiState } from "@/lib/api-state";

/**
 * Loads one API resource on mount and whenever `load` changes; `reload` fetches again. `load` must be
 * stable (a function from `api` in lib/api.ts, or one wrapped in useCallback). When `load` changes
 * (another tab or range), the state is "loading" until its answer lands, never the old answer.
 */
export function useApi<T>(load: (init?: RequestInit) => Promise<T>): ApiState<T> & { reload: () => void } {
  const [last, setLast] = useState<Settled<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setLast(settled(load, { status: "ready", data }));
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof ApiError ? err : new ApiError(String(err), "http");
        setLast(settled(load, { status: "error", error }));
      },
    );
    return () => controller.abort();
  }, [load, attempt]);

  const reload = useCallback(() => {
    setLast(null);
    setAttempt((n) => n + 1);
  }, []);
  return { ...visibleState(last, load), reload };
}

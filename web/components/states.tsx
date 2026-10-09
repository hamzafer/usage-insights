import { CircleSlash, PlugZap, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";

/**
 * Non-happy paths with a designed surface: the API is down, or it answers but nothing is recorded.
 * Copy says what happened and what to do next.
 */

export function ApiErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const offline = error.kind === "offline";
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border bg-card px-5 py-6 sm:flex-row sm:items-center">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground">
        <PlugZap className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{offline ? "Can't reach the dashboard server" : "The server could not read the data"}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {offline ? (
            <>
              Start it with <code className="font-mono text-foreground">bun run dashboard</code>, then try again.
            </>
          ) : (
            error.message
          )}
        </p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden /> Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-8 sm:flex-row sm:items-center">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground">
        <CircleSlash className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 max-w-prose text-[13px] text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

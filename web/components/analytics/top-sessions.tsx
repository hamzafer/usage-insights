"use client";

import { useCallback, useState } from "react";
import type { AnalyticsSectionProps } from "@/components/analytics/types";
import { ALL_PROVIDERS, ProviderTabs } from "@/components/provider-tabs";
import { Section } from "@/components/section";
import { ApiErrorState, EmptyState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { byProviderOrder, providerColor, providerName } from "@/lib/providers";
import { compactTokens, limitText, sessionDuration, sessionStart } from "@/lib/top-sessions";
import type { TopSession } from "@/lib/types";

const RANGE_TEXT: Record<string, string> = { "7d": "7 days", "30d": "30 days" };

/**
 * Top sessions (#21): the range's biggest Claude Code and Codex sessions by tokens, with how much
 * of the 5-hour and weekly limits each took (`GET /api/sessions/top?range=`). Codex is Measured from
 * its logs; Claude is "~" once its calibration is ready, "—" until then. Provider tabs (All first)
 * ask the API for one Provider's top sessions, so Codex's Measured sessions are not crowded out by
 * Claude's cache-heavy token counts.
 */
export function TopSessions({ range }: AnalyticsSectionProps) {
  const [picked, setPicked] = useState<string>(ALL_PROVIDERS);
  const provider = picked === ALL_PROVIDERS ? undefined : picked;
  const load = useCallback((init?: RequestInit) => api.topSessions(range, provider, init), [range, provider]);
  const state = useApi(load);
  const title = "Top sessions";
  const description = `The biggest sessions of the last ${RANGE_TEXT[range] ?? range}, by tokens.`;
  const providers = state.status === "ready" ? state.data.providers.toSorted(byProviderOrder) : [];
  const tabs =
    providers.length > 1 ? <ProviderTabs all providers={providers} value={picked} onChange={setPicked} /> : null;

  if (state.status === "error") {
    return (
      <Section title={title} description={description}>
        <ApiErrorState error={state.error} onRetry={state.reload} />
      </Section>
    );
  }
  if (state.status === "loading") {
    return (
      <Section title={title} description={description}>
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading sessions">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </Section>
    );
  }

  const { sessions } = state.data;
  if (sessions.length === 0 && provider === undefined) {
    return (
      <Section title={title} description={description}>
        <EmptyState title="No sessions in this range">
          Sessions show up once the token Backfill has read Claude Code or Codex logs (it runs every hour
          with the Recorder, or now with <code className="font-mono text-foreground">bun run backfill:tokens</code>).
        </EmptyState>
      </Section>
    );
  }

  const tokensOnly = sessions.some((s) => s.basis === null && s.provider !== "codex");
  return (
    <Section title={title} description={description}>
      {tabs ? <div className="mb-4">{tabs}</div> : null}
      {sessions.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">No {providerName(picked)} sessions in this range.</p>
      ) : (
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-0">Session</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="w-32 text-right">5-hour limit</TableHead>
              <TableHead className="w-32 pr-0 text-right">Weekly limit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <SessionRow key={`${s.provider}/${s.id}`} session={s} />
            ))}
          </TableBody>
        </Table>
      )}
      <p className="mt-3 max-w-prose text-xs text-muted-foreground">
        Codex limits are Measured from its logs: how far each limit moved while the session ran (sessions at the
        same time share it). Claude&apos;s are estimated from tokens (~)
        {tokensOnly ? ", and show — until its calibration is ready" : ""}.
      </p>
    </Section>
  );
}

function SessionRow({ session: s }: { session: TopSession }) {
  return (
    <TableRow>
      <TableCell className="pl-0">
        <p className="max-w-56 truncate font-medium" title={s.project}>
          {s.project}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {sessionStart(s.startedAt)}, {sessionDuration(s.startedAt, s.endedAt)}
        </p>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: providerColor(s.provider) }} aria-hidden />
          {providerName(s.provider)}
        </span>
      </TableCell>
      <TableCell className="max-w-44 truncate font-mono text-xs text-muted-foreground" title={s.model}>
        {s.model}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums" title={`${s.tokens.toLocaleString("en-US")} tokens in ${s.calls} calls`}>
        {compactTokens(s.tokens)}
      </TableCell>
      <LimitCell session={s} share={s.sessionShare} limit="5-hour" />
      <LimitCell session={s} share={s.weeklyShare} limit="weekly" className="pr-0" />
    </TableRow>
  );
}

/** A share of one limit: the number, and a thin meter in the Plan's color (faded when estimated). */
function LimitCell({
  session,
  share,
  limit,
  className,
}: {
  session: TopSession;
  share: number | null;
  limit: string;
  className?: string;
}) {
  const text = limitText(share, session.basis);
  const known = share !== null && session.basis !== null;
  const explain = !known
    ? session.provider === "codex"
      ? `No ${limit} limit readings in this session's logs.`
      : `Unknown until the Claude calibration is ready.`
    : session.basis === "estimated"
      ? `Estimated from tokens with the calibration: about ${text.slice(1)} of the ${limit} limit.`
      : `Measured: the ${limit} limit moved ${text} while this session ran.`;
  return (
    <TableCell className={className}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="ml-auto flex w-24 flex-col items-end gap-1" tabIndex={0} aria-label={`${limit} limit: ${text}. ${explain}`}>
            <span className={known ? "font-mono tabular-nums" : "font-mono text-muted-foreground"}>{text}</span>
            {known ? (
              <span className="relative h-1 w-full overflow-hidden rounded-full bg-track" aria-hidden>
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.min(1, Math.max(0, share)) * 100}%`,
                    background: providerColor(session.provider),
                    opacity: session.basis === "estimated" ? 0.55 : 1,
                  }}
                />
              </span>
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent>{explain}</TooltipContent>
      </Tooltip>
    </TableCell>
  );
}

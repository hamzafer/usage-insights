"use client";

import { useState } from "react";
import { ApiErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { clock, dayMonth } from "@/lib/format";
import { ago, gapsToday, healthPill, jobName, type Pill, type PillTone, recentFailures } from "@/lib/health";
import { byProviderOrder, providerColor, providerName } from "@/lib/providers";
import type { DataHealth } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Rows per list in the sheet; the newest first. */
const LIST = 6;
/** Claude calibration minimums (src/calibration.ts). */
const MIN_SAMPLES = 10;
const MIN_MOVEMENT = 20;

const TONE_COLOR: Record<PillTone, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
};

/**
 * The data-health pill in the header (#22): "● Recording", "● 2 gaps today" or "● Run failed"
 * (lib/health.ts), always a dot plus a label. It opens a sheet with the details: the last Snapshot
 * per Provider, recorder gaps, failed runs, unclassified lines and the Claude calibration.
 */
export function StatusPill() {
  const health = useApi(api.health);
  const [now] = useState(() => new Date().toISOString());

  const pill: Pill | null =
    health.status === "ready"
      ? healthPill(health.data, now)
      : health.status === "error"
        ? { tone: "critical", label: "Offline", description: "The dashboard server is not answering." }
        : null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-2 rounded-full px-2.5 text-xs font-normal"
          aria-label={pill ? `Data health: ${pill.label}. ${pill.description} Open details.` : "Data health: checking"}
        >
          <span
            aria-hidden
            className={cn("size-2 rounded-full", !pill && "animate-pulse")}
            style={{ background: pill ? TONE_COLOR[pill.tone] : "var(--status-unknown)" }}
          />
          <span>{pill?.label ?? "Checking"}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">Data health</SheetTitle>
          <SheetDescription className="flex items-center gap-2 text-[13px]">
            {pill ? (
              <>
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[pill.tone] }} />
                <span>
                  <span className="text-foreground">{pill.label}.</span> {pill.description}
                </span>
              </>
            ) : (
              "Checking the recorded data."
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col px-5 pb-6">
          {health.status === "loading" ? (
            <div className="flex flex-col gap-3 pt-5" aria-busy="true" aria-label="Loading data health">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : health.status === "error" ? (
            <div className="pt-5">
              <ApiErrorState error={health.error} onRetry={health.reload} />
            </div>
          ) : (
            <HealthDetails health={health.data} now={now} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function HealthDetails({ health, now }: { health: DataHealth; now: string }) {
  const providers = health.providers.toSorted((a, b) => byProviderOrder(a.provider, b.provider));
  const failed = recentFailures(health.failedRuns, now);
  const olderFailed = health.failedRuns.length - failed.length;
  const today = gapsToday(health, now);
  const claude = health.calibration.toSorted((a, b) => byProviderOrder(a.provider, b.provider));

  return (
    <>
      <Block title="Last Snapshot" note="Recorded every 5 minutes; stale after 30 minutes without one.">
        {providers.length === 0 ? (
          <Empty>Nothing recorded yet. Start the Recorder with <Code>bun run record</Code>.</Empty>
        ) : (
          <Rows>
            {providers.map((p) => (
              <Row key={p.provider} label={<ProviderLabel id={p.provider} />}>
                {p.lastSnapshotAt ? (
                  <span className="text-xs">
                    {ago(p.lastSnapshotAt, now)}
                    <span className="font-mono text-muted-foreground tabular-nums"> {when(p.lastSnapshotAt)}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Backfill only</span>
                )}
                {p.stale && p.lastSnapshotAt ? <StatusText tone="warning">stale</StatusText> : null}
              </Row>
            ))}
          </Rows>
        )}
      </Block>

      <Block title="Failed runs" note={olderFailed > 0 ? `${olderFailed} older ${olderFailed === 1 ? "failure" : "failures"} not counted in the pill.` : "Backfill and Report runs."}>
        {health.failedRuns.length === 0 ? (
          <Empty>No failed runs.</Empty>
        ) : (
          <Rows>
            {health.failedRuns.slice(0, LIST).map((r) => (
              <li key={`${r.job}-${r.at}`} className="flex flex-col gap-0.5 py-2">
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    {failed.includes(r) ? <Dot tone="critical" /> : <Dot />}
                    {jobName(r.job)}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{when(r.at)}</span>
                </span>
                {r.reason ? <span className="pl-4 text-xs break-words text-muted-foreground">{r.reason}</span> : null}
              </li>
            ))}
          </Rows>
        )}
      </Block>

      <Block title="Recorder gaps" note={`${today} today. A gap is a Recorder run that could not take a Snapshot.`}>
        {health.recorderGaps.length === 0 ? (
          <Empty>No recorder gaps.</Empty>
        ) : (
          <Rows>
            {health.recorderGaps.slice(0, LIST).map((g, i) => (
              <Row key={`${g.recordedAt}-${i}`} label={<span className="text-muted-foreground">{g.reason}</span>}>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{when(g.recordedAt)}</span>
              </Row>
            ))}
          </Rows>
        )}
      </Block>

      <Block title="Unclassified lines" note="Lines OpenUsage reports that are not a Session, Cycle or Overage yet.">
        {health.unclassified.length === 0 ? (
          <Empty>Every line is classified.</Empty>
        ) : (
          <Rows>
            {health.unclassified.map((u) => (
              <Row key={`${u.provider}/${u.label}`} label={<ProviderLabel id={u.provider} extra={u.label} />}>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{when(u.lastSeenAt)}</span>
              </Row>
            ))}
          </Rows>
        )}
      </Block>

      <Block
        title="Claude calibration"
        note={`Claude's Waste and limits are Estimated (~) from tokens once a line has ${MIN_SAMPLES} samples and ${MIN_MOVEMENT} points of movement.`}
      >
        {claude.length === 0 ? (
          <Empty>No Claude lines recorded.</Empty>
        ) : (
          <Rows>
            {claude.map((c) => (
              <Row key={`${c.provider}/${c.label}`} label={<ProviderLabel id={c.provider} extra={c.label} />}>
                {c.ready ? (
                  <StatusText tone="good">
                    ready
                    {c.tokensPerPercent ? <span className="text-muted-foreground">, {compact(c.tokensPerPercent)} tokens per 1%</span> : null}
                  </StatusText>
                ) : (
                  <StatusText tone="warning">
                    calibrating
                    <span className="text-muted-foreground">
                      {" "}({Math.min(c.samples, MIN_SAMPLES)} of {MIN_SAMPLES} samples)
                    </span>
                  </StatusText>
                )}
              </Row>
            ))}
          </Rows>
        )}
      </Block>
    </>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-b py-4 last:border-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y text-[13px]">{children}</ul>;
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-2 text-right">{children}</span>
    </li>
  );
}

function ProviderLabel({ id, extra }: { id: string; extra?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: providerColor(id) }} />
      {providerName(id)}
      {extra ? <span className="truncate text-muted-foreground">{extra}</span> : null}
    </span>
  );
}

function StatusText({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <Dot tone={tone} />
      <span>{children}</span>
    </span>
  );
}

function Dot({ tone }: { tone?: PillTone }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ background: tone ? TONE_COLOR[tone] : "var(--status-unknown)" }}
    />
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-[13px] text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-foreground">{children}</code>;
}

/** "5 Oct 14:05". */
function when(iso: string): string {
  return `${dayMonth(iso)} ${clock(iso)}`;
}

function compact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

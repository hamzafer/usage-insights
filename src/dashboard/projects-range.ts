import { modelName } from "../names.ts";
import { type Share, topUsage } from "../token-shares.ts";
import type { DashboardData } from "./view-model.ts";

/**
 * `GET /api/projects?range=7d|30d` (ticket #18): Projects and models ranked per Provider over the
 * last 7 or 30 days, for the Analytics ranked lists. Pure, no I/O. Projects carry folder names only.
 */

const DAY_MS = 24 * 3_600_000;
const PROJECT_RANGE_DAYS = { "7d": 7, "30d": 30 } as const;
export type ProjectsRangeKey = keyof typeof PROJECT_RANGE_DAYS;

export function isProjectsRange(value: string): value is ProjectsRangeKey {
  return Object.hasOwn(PROJECT_RANGE_DAYS, value);
}

/** A ranked row: a Project's folder name or a model id, with the name a person reads. */
export interface RankedShare extends Share {
  /** The folder name for a Project; the friendly model name ("Opus 5.5") for a model. */
  label: string;
}

export interface ProviderRanking {
  provider: string;
  /** Tokens in the range, as logged. */
  total: number;
  /** Largest first, shares of `total`. */
  projects: RankedShare[];
  models: RankedShare[];
}

export interface ProjectsRange {
  range: ProjectsRangeKey;
  /** Inclusive. */
  from: string;
  /** Exclusive: now. */
  to: string;
  /** Every Provider with token logs, by id; one without tokens in the range has total 0 and empty lists. */
  providers: ProviderRanking[];
}

/**
 * The ranked lists for the last `range` days, for every Provider that has token logs at all (so its
 * tab stays while the range is quiet).
 */
export function buildProjectsRange(data: DashboardData, now: string | Date, range: ProjectsRangeKey): ProjectsRange {
  const toMs = typeof now === "string" ? Date.parse(now) : now.getTime();
  const to = new Date(toMs).toISOString();
  const from = new Date(toMs - PROJECT_RANGE_DAYS[range] * DAY_MS).toISOString();
  const events = data.tokens ?? [];
  const providers = [...new Set(events.map((e) => e.provider))].toSorted();
  return {
    range,
    from,
    to,
    providers: providers.map((provider) => {
      const shares = topUsage(events, { from, to, providers: [provider] });
      return {
        provider,
        total: shares.total,
        projects: shares.byProject.map((s) => ({ ...s, label: s.name })),
        models: shares.byModel.map((s) => ({ ...s, label: modelName(s.name) })),
      };
    }),
  };
}

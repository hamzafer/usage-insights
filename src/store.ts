import { Database } from "bun:sqlite";
import type { LineRole } from "./classify.ts";
import { LIVE_SOURCE } from "./providers.ts";
import type { Reading } from "./window-model.ts";

/** One stored progress line of one Snapshot. */
export interface StoredReading {
  provider: string;
  label: string;
  role: LineRole;
  used: number;
  limit: number;
  unit: string;
  resetsAt: string | null;
  periodMs: number | null;
  plan: string | null;
  fetchedAt: string;
  recordedAt: string;
  /** Where the reading came from: LIVE_SOURCE (a Snapshot, the default) or `backfill:<provider>`. */
  source?: string;
}

/**
 * Tokens of one API call (spec §4) from Claude Code or Codex logs, with its Project and model.
 * Counted from logs, not converted. `input` excludes cache reads and writes.
 */
export interface TokenEvent {
  /** `claude`, `claude-work` or `codex`. */
  provider: string;
  at: string;
  /**
   * The Project's repository root; for a Codex session whose folder is gone, the repository name
   * from its git remote; null for "(other)". Never shown in full (see projectName).
   */
  project: string | null;
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/** A TokenEvent with the key it is deduplicated on (e.g. message and request id). */
export interface KeyedTokenEvent extends TokenEvent {
  key: string;
}

/** A recording run that got no Snapshot, and why (ADR 0001: gaps must be visible). */
export interface Gap {
  recordedAt: string;
  reason: string;
}

/** The outcome of one Backfill or Report run (spec: Error handling: failures are visible). */
export interface RunOutcome {
  /** `backfill:codex`, `backfill:tokens` or `report`. */
  job: string;
  at: string;
  ok: boolean;
  /** Why it failed; null when it went fine. */
  reason: string | null;
}

/**
 * Schema migrations, applied in order. The database's `user_version` pragma holds how many
 * have run. Never edit a shipped migration; append a new one.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE readings (
     id          INTEGER PRIMARY KEY,
     provider    TEXT NOT NULL,
     label       TEXT NOT NULL,
     role        TEXT NOT NULL,
     used        REAL NOT NULL,
     "limit"     REAL NOT NULL,
     unit        TEXT NOT NULL,
     resets_at   TEXT,
     period_ms   INTEGER,
     plan        TEXT,
     fetched_at  TEXT NOT NULL,
     recorded_at TEXT NOT NULL,
     source      TEXT NOT NULL DEFAULT 'openusage',
     UNIQUE (provider, label, fetched_at)
   );
   CREATE INDEX readings_by_line ON readings (provider, label, fetched_at);
   CREATE TABLE gaps (
     id          INTEGER PRIMARY KEY,
     recorded_at TEXT NOT NULL,
     reason      TEXT NOT NULL
   );`,
  // How far each Backfill has read each log file, so reruns only read what was appended.
  `CREATE TABLE backfill_progress (
     source      TEXT NOT NULL,
     path        TEXT NOT NULL,
     offset      INTEGER NOT NULL,
     PRIMARY KEY (source, path)
   );`,
  // Tokens per API call from Claude Code and Codex logs (ticket #7), deduplicated on `key`.
  `CREATE TABLE token_events (
     id          INTEGER PRIMARY KEY,
     key         TEXT NOT NULL UNIQUE,
     provider    TEXT NOT NULL,
     at          TEXT NOT NULL,
     project     TEXT,
     model       TEXT NOT NULL,
     input       INTEGER NOT NULL,
     cache_write INTEGER NOT NULL,
     cache_read  INTEGER NOT NULL,
     output      INTEGER NOT NULL
   );
   CREATE INDEX token_events_by_time ON token_events (at);`,
  // Outcomes of Backfill and Report runs (spec: Error handling), shown on the data-health page and
  // used to run the automatic Backfills at most once per hour.
  `CREATE TABLE runs (
     id          INTEGER PRIMARY KEY,
     job         TEXT NOT NULL,
     at          TEXT NOT NULL,
     ok          INTEGER NOT NULL,
     reason      TEXT
   );
   CREATE INDEX runs_by_job ON runs (job, at);`,
];

export interface Store {
  /** Stores readings, skipping any already stored. Returns how many rows were new. */
  saveReadings(readings: StoredReading[]): number;
  saveGap(gap: Gap): void;
  /** The newest reading of every (provider, label), sorted by provider then label. */
  latestReadings(): StoredReading[];
  /** Readings of the given roles, as the Window Model takes them: by provider, label, then time. */
  readingsWithRole(roles: LineRole[]): Reading[];
  /** The newest gaps first. */
  recentGaps(limit: number): Gap[];
  /** Every gap, oldest first (Idle Capacity treats the time around each as unknown). */
  allGaps(): Gap[];
  countReadings(): number;
  /** The plan of the provider's newest live Snapshot (not a Backfill), or null. */
  livePlan(provider: string): string | null;
  /** Bytes of a log file a Backfill (`source`) has already read; 0 for a new file. */
  backfillOffset(source: string, path: string): number;
  saveBackfillOffset(source: string, path: string, offset: number): void;
  /**
   * Stores token events, one per key; a key seen again keeps its earliest time. Returns how many
   * keys were new.
   */
  saveTokenEvents(events: KeyedTokenEvent[]): number;
  /** Token events, oldest first; only those at or after `from` and before `to` when given. */
  tokenUsage(range?: { from?: string; to?: string }): TokenEvent[];
  saveRun(outcome: RunOutcome): void;
  /** The newest run outcomes first. */
  recentRuns(limit: number): RunOutcome[];
  /** When the job last ran (ok or not), or null. */
  lastRunAt(job: string): string | null;
  close(): void;
}

export function openStore(path: string): Store {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO readings
       (provider, label, role, used, "limit", unit, resets_at, period_ms, plan, fetched_at, recorded_at, source)
     VALUES ($provider, $label, $role, $used, $limit, $unit, $resetsAt, $periodMs, $plan, $fetchedAt, $recordedAt, $source)`,
  );
  const insertMany = db.transaction((rows: StoredReading[]) => {
    let added = 0;
    for (const row of rows) added += insert.run({ ...row, source: row.source ?? LIVE_SOURCE }).changes;
    return added;
  });

  const insertToken = db.prepare(
    `INSERT OR IGNORE INTO token_events (key, provider, at, project, model, input, cache_write, cache_read, output)
     VALUES ($key, $provider, $at, $project, $model, $input, $cacheWrite, $cacheRead, $output)`,
  );
  const keepEarliest = db.prepare("UPDATE token_events SET at = $at WHERE key = $key AND at > $at");
  const saveTokens = db.transaction((events: KeyedTokenEvent[]) => {
    let added = 0;
    for (const e of events) {
      const changes = insertToken.run({ ...e }).changes;
      added += changes;
      if (!changes) keepEarliest.run({ key: e.key, at: e.at });
    }
    return added;
  });

  return {
    saveReadings: (readings) => insertMany(readings),
    saveTokenEvents: (events) => saveTokens(events),
    tokenUsage: ({ from = "", to = "￿" } = {}) =>
      db
        .query<TokenEvent, [string, string]>(
          `SELECT provider, at, project, model, input, cache_write AS cacheWrite, cache_read AS cacheRead, output
             FROM token_events WHERE at >= ? AND at < ? ORDER BY at, id`,
        )
        .all(from, to),
    saveGap: (gap) => {
      db.query("INSERT INTO gaps (recorded_at, reason) VALUES ($recordedAt, $reason)").run({ ...gap });
    },
    latestReadings: () =>
      db
        .query<StoredReading, []>(
          `SELECT provider, label, role, used, "limit", unit,
                  resets_at AS resetsAt, period_ms AS periodMs, plan,
                  fetched_at AS fetchedAt, recorded_at AS recordedAt
             FROM readings r
            WHERE fetched_at = (SELECT MAX(fetched_at) FROM readings
                                 WHERE provider = r.provider AND label = r.label)
            ORDER BY provider, label`,
        )
        .all(),
    readingsWithRole: (roles) =>
      db
        .query<Reading, string[]>(
          `SELECT provider, label, role, used, "limit", resets_at AS resetsAt,
                  fetched_at AS fetchedAt, source, period_ms AS periodMs
             FROM readings
            WHERE role IN (${roles.map(() => "?").join(", ")})
            ORDER BY provider, label, fetched_at, id`,
        )
        .all(...roles),
    recentGaps: (limit) =>
      db
        .query<Gap, [number]>(
          `SELECT recorded_at AS recordedAt, reason FROM gaps
            ORDER BY recorded_at DESC, id DESC LIMIT ?`,
        )
        .all(limit),
    allGaps: () =>
      db
        .query<Gap, []>("SELECT recorded_at AS recordedAt, reason FROM gaps ORDER BY recorded_at, id")
        .all(),
    countReadings: () =>
      db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM readings").get()?.n ?? 0,
    livePlan: (provider) =>
      db
        .query<{ plan: string | null }, [string, string]>(
          `SELECT plan FROM readings WHERE provider = ? AND source = ?
            ORDER BY fetched_at DESC, id DESC LIMIT 1`,
        )
        .get(provider, LIVE_SOURCE)?.plan ?? null,
    backfillOffset: (source, path) =>
      db
        .query<{ offset: number }, [string, string]>(
          "SELECT offset FROM backfill_progress WHERE source = ? AND path = ?",
        )
        .get(source, path)?.offset ?? 0,
    saveBackfillOffset: (source, path, offset) => {
      db.query(
        `INSERT INTO backfill_progress (source, path, offset) VALUES (?, ?, ?)
           ON CONFLICT (source, path) DO UPDATE SET offset = excluded.offset`,
      ).run(source, path, offset);
    },
    saveRun: (outcome) => {
      db.query("INSERT INTO runs (job, at, ok, reason) VALUES (?, ?, ?, ?)").run(
        outcome.job,
        outcome.at,
        outcome.ok ? 1 : 0,
        outcome.reason,
      );
    },
    recentRuns: (limit) =>
      db
        .query<{ job: string; at: string; ok: number; reason: string | null }, [number]>(
          "SELECT job, at, ok, reason FROM runs ORDER BY at DESC, id DESC LIMIT ?",
        )
        .all(limit)
        .map((r) => ({ ...r, ok: r.ok === 1 })),
    lastRunAt: (job) =>
      db.query<{ at: string | null }, [string]>("SELECT MAX(at) AS at FROM runs WHERE job = ?").get(job)?.at ?? null,
    close: () => db.close(),
  };
}

function migrate(db: Database): void {
  const current = db.query<{ user_version: number }, []>("PRAGMA user_version").get()
    ?.user_version ?? 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    })();
  }
}

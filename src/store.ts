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
  /**
   * The Claude Code session (`sessionId`) or Codex session (its `session_meta` id) the call belongs
   * to; null or omitted when the log does not say.
   */
  session?: string | null;
}

/** A TokenEvent with its session (ticket #21: top sessions); null for calls stored without one. */
export interface SessionTokenEvent extends TokenEvent {
  session: string | null;
}

/** A recording run that got no Snapshot, and why (ADR 0001: gaps must be visible). */
export interface Gap {
  recordedAt: string;
  reason: string;
}

/** How far a Backfill has read one log file. */
export interface BackfillProgress {
  /** Bytes read: the end of the last complete line. */
  offset: number;
  /** A hash of the file's first bytes (up to 4 KB, never past `offset`); null in rows from before it was kept. */
  head: string | null;
  /** The parser's state at `offset` (JSON), for parsers that need earlier lines; null when none. */
  context: string | null;
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
export const MIGRATIONS: string[] = [
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
  // A fingerprint of each log file's start, so a rewritten file is read again from the start, and
  // the parser state at the offset, so a rerun need not read the file's earlier lines again.
  `ALTER TABLE backfill_progress ADD COLUMN head TEXT;
   ALTER TABLE backfill_progress ADD COLUMN context TEXT;`,
  // The session of each token event (ticket #21). The token Backfill's progress is reset, so its
  // next run reads every log again and fills the session of events stored before; their keys stay
  // the same, so nothing is counted twice.
  `ALTER TABLE token_events ADD COLUMN session TEXT;
   CREATE INDEX token_events_by_session ON token_events (provider, session);
   DELETE FROM backfill_progress WHERE source LIKE 'tokens:%';`,
];

/** How long a statement waits for another process's lock before failing. */
const BUSY_TIMEOUT_MS = 5000;

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
  /** How far a Backfill (`source`) has read a log file; null for a new file. */
  backfillProgress(source: string, path: string): BackfillProgress | null;
  saveBackfillProgress(source: string, path: string, progress: BackfillProgress): void;
  /**
   * Stores token events, one per key; a key seen again keeps its earliest time and gets its session
   * when it had none. Returns how many keys were new.
   */
  saveTokenEvents(events: KeyedTokenEvent[]): number;
  /** Token events, oldest first; only those at or after `from` and before `to` when given. */
  tokenUsage(range?: { from?: string; to?: string }): TokenEvent[];
  /** Every Provider with token events, sorted (without reading the events). */
  tokenProviders(): string[];
  /** As tokenUsage, with each event's session. */
  sessionTokenUsage(range?: { from?: string; to?: string }): SessionTokenEvent[];
  saveRun(outcome: RunOutcome): void;
  /** The newest run outcomes first. */
  recentRuns(limit: number): RunOutcome[];
  /** When the job last ran (ok or not), or null. */
  lastRunAt(job: string): string | null;
  close(): void;
}

/** A read-only open found a data file from an older version, which only a normal open migrates. */
export class OutdatedStoreError extends Error {
  constructor(path: string, version: number) {
    super(
      `The data file ${path} is from an older version (schema ${version} of ${MIGRATIONS.length}) and a read-only ` +
        "open cannot update it. Run any recording command once (e.g. `bun run record`) to migrate it, then try again.",
    );
    this.name = "OutdatedStoreError";
  }
}

/**
 * Opens (creating and migrating) the store at `path`. `readonly`: for dry runs and page views, which
 * write nothing; the file must exist and be migrated already (else OutdatedStoreError), and it is
 * neither migrated nor switched to WAL (writes then throw).
 */
export function openStore(path: string, options: { readonly?: boolean } = {}): Store {
  const db = options.readonly
    ? new Database(path, { readonly: true, strict: true })
    : new Database(path, { create: true, strict: true });
  // The Recorder, Backfills, Report and dashboard run as separate processes: wait for another's
  // lock instead of failing with "database is locked".
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  if (!options.readonly) {
    useWal(db);
    migrate(db);
  } else if (userVersion(db) < MIGRATIONS.length) {
    const version = userVersion(db);
    db.close();
    throw new OutdatedStoreError(path, version);
  }

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
    `INSERT OR IGNORE INTO token_events (key, provider, at, project, model, input, cache_write, cache_read, output, session)
     VALUES ($key, $provider, $at, $project, $model, $input, $cacheWrite, $cacheRead, $output, $session)`,
  );
  const keepEarliest = db.prepare("UPDATE token_events SET at = $at WHERE key = $key AND at > $at");
  const fillSession = db.prepare("UPDATE token_events SET session = $session WHERE key = $key AND session IS NULL");
  const saveTokens = db.transaction((events: KeyedTokenEvent[]) => {
    let added = 0;
    for (const e of events) {
      const session = e.session ?? null;
      const changes = insertToken.run({ ...e, session }).changes;
      added += changes;
      if (changes) continue;
      keepEarliest.run({ key: e.key, at: e.at });
      if (session !== null) fillSession.run({ key: e.key, session });
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
    tokenProviders: () =>
      db
        .query<{ provider: string }, []>("SELECT DISTINCT provider FROM token_events ORDER BY provider")
        .all()
        .map((r) => r.provider),
    sessionTokenUsage: ({ from = "", to = "\uffff" } = {}) =>
      db
        .query<SessionTokenEvent, [string, string]>(
          `SELECT provider, at, project, model, input, cache_write AS cacheWrite, cache_read AS cacheRead, output, session
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
    backfillProgress: (source, path) =>
      db
        .query<BackfillProgress, [string, string]>(
          "SELECT offset, head, context FROM backfill_progress WHERE source = ? AND path = ?",
        )
        .get(source, path),
    saveBackfillProgress: (source, path, { offset, head, context }) => {
      db.query(
        `INSERT INTO backfill_progress (source, path, offset, head, context) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (source, path) DO UPDATE
             SET offset = excluded.offset, head = excluded.head, context = excluded.context`,
      ).run(source, path, offset, head, context);
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

function userVersion(db: Database): number {
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
}

/**
 * Applies the pending migrations. The version is read again inside one write transaction
 * (BEGIN IMMEDIATE), so two processes opening an old data file never both apply a migration.
 */
function migrate(db: Database): void {
  if (userVersion(db) >= MIGRATIONS.length) return;
  db.transaction(() => {
    for (let version = userVersion(db); version < MIGRATIONS.length; version++) {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    }
  }).immediate();
}

/**
 * Switches to WAL, so readers never block the writer. SQLite skips the busy timeout for this
 * switch when another process holds a lock, so it is retried until the timeout.
 */
function useWal(db: Database): void {
  const deadline = Date.now() + BUSY_TIMEOUT_MS;
  for (;;) {
    try {
      const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode;
      if (mode !== "wal") db.exec("PRAGMA journal_mode = WAL;");
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== "SQLITE_BUSY" || Date.now() >= deadline) throw error;
      Bun.sleepSync(20);
    }
  }
}

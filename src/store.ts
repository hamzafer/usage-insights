import { Database } from "bun:sqlite";
import type { LineRole } from "./classify.ts";
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
  /** Where the reading came from: `openusage` (a Snapshot, the default) or `backfill:<provider>`. */
  source?: string;
}

/** A recording run that got no Snapshot, and why (ADR 0001: gaps must be visible). */
export interface Gap {
  recordedAt: string;
  reason: string;
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
  countReadings(): number;
  /** Bytes of a log file a Backfill (`source`) has already read; 0 for a new file. */
  backfillOffset(source: string, path: string): number;
  saveBackfillOffset(source: string, path: string, offset: number): void;
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
    for (const row of rows) added += insert.run({ ...row, source: row.source ?? "openusage" }).changes;
    return added;
  });

  return {
    saveReadings: (readings) => insertMany(readings),
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
                  fetched_at AS fetchedAt, source
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
    countReadings: () =>
      db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM readings").get()?.n ?? 0,
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

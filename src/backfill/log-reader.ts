import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import type { Store } from "../store.ts";

/**
 * Incremental reading of append-only log files for the Backfills: each run reads only the
 * complete lines appended since the last one. A line still being written is left for the next
 * run. A file that shrank, or whose start changed (rotated or rewritten), is read again from the start.
 */

/** How much of a file's start its fingerprint covers. */
const HEAD_BYTES = 4096;
const NEWLINE = 0x0a;

export interface NewLines {
  lines: string[];
  /** The parser state saved with the last run; null when this read starts at the file's start. */
  context: string | null;
  /** The lines before the ones read (for progress saved before the context was kept). */
  earlier(): string[];
  /** Records these lines as read, with the parser state after them. */
  done(context?: string | null): void;
}

/** The complete lines of `file` appended since the last run of `source`, or null when there are none. */
export function readNewLines(store: Store, source: string, file: string, key: string): NewLines | null {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const saved = store.backfillProgress(source, key);
    let from = saved?.offset ?? 0;
    const rewritten = saved && (from > size || (saved.head !== null && headHash(fd, from) !== saved.head));
    if (rewritten) from = 0;
    if (from >= size) return null;

    const tail = read(fd, from, size - from);
    const last = tail.lastIndexOf(NEWLINE);
    if (last < 0) return null;
    const end = from + last + 1;
    const head = headHash(fd, end);
    return {
      lines: tail.subarray(0, last).toString("utf8").split("\n"),
      context: from ? (saved?.context ?? null) : null,
      earlier: () => (from ? readFileSync(file).subarray(0, from).toString("utf8").split("\n") : []),
      done: (context = null) => store.saveBackfillProgress(source, key, { offset: end, head, context }),
    };
  } finally {
    closeSync(fd);
  }
}

function read(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buffer, got, length - got, position + got);
    if (n === 0) break;
    got += n;
  }
  return buffer.subarray(0, got);
}

/** The fingerprint of the file's first bytes, up to 4 KB and never past `upTo` (what was read). */
function headHash(fd: number, upTo: number): string {
  return createHash("sha256").update(read(fd, 0, Math.min(HEAD_BYTES, upTo))).digest("hex").slice(0, 32);
}

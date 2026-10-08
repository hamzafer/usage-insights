// Latest reading per Provider and line, plus recent gaps (`bun run status`).
import { mkdirSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { formatStatus } from "../status.ts";
import { openStore } from "../store.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbPath);
try {
  console.log(formatStatus(store));
} finally {
  store.close();
}

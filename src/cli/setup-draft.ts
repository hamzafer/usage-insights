// `bun run setup:draft`: writes a DRAFT Setup file (<data dir>/setup.md) from the template when there
// is none yet. An existing file is never touched. Edit it, then remove DRAFT from its first line.
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { ensureSetup, SETUP_FILE } from "../report/setup.ts";

const config = loadConfig();
const path = join(config.dataDir, SETUP_FILE);
const { created } = ensureSetup(config.dataDir);
console.log(
  created
    ? `Drafted ${path}. Fill it in, then remove DRAFT from its first line.`
    : `${path} already exists; left as it is.`,
);

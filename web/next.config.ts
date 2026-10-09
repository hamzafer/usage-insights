import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * Production: a static export (`out/`) that the Bun server serves next to the JSON API on
 * 127.0.0.1:6740 (ADR 0003). Development (`next dev`): no export, and `/api/*` is proxied to the
 * Bun server, so run `bun run dashboard` alongside.
 */
const API_ORIGIN = `http://127.0.0.1:${process.env.USAGE_INSIGHTS_PORT || "6740"}`;

const base: NextConfig = {
  turbopack: {
    // web/ is its own app (own lockfile) inside the repo: pin the root to it.
    root: __dirname,
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...base,
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
      },
    };
  }
  return { ...base, output: "export", images: { unoptimized: true } };
}

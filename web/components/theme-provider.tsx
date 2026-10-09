"use client";

import { ThemeProvider as NextThemes } from "next-themes";

/**
 * Follows the system's light or dark setting until the user toggles, then remembers the choice.
 * Works in the static export: next-themes sets the class before the first paint.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

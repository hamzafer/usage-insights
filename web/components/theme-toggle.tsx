"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Switches between light and dark; the choice then overrides the system setting. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === "light" ? "dark" : "light";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={() => setTheme(next)} aria-label="Toggle light and dark theme">
          <Sun className="hidden size-4 dark:block" aria-hidden />
          <Moon className="size-4 dark:hidden" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Light or dark theme</TooltipContent>
    </Tooltip>
  );
}

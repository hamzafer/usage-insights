"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusPill } from "@/components/status-pill";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/analytics", label: "Analytics" },
] as const;

/** Title row (name, data-health pill, theme toggle) over a row of page tabs, Vercel style. */
export function SiteHeader() {
  const pathname = usePathname().replace(/\/+$/, "") || "/";
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-md text-[15px] font-semibold tracking-tight">
          <Mark />
          Usage Insights
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <StatusPill />
          <ThemeToggle />
        </div>
      </div>
      <nav aria-label="Pages" className="mx-auto flex w-full max-w-7xl gap-1 px-2.5 sm:px-4.5">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative rounded-md px-2.5 pt-1 pb-3 text-sm transition-colors",
                "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full",
                active
                  ? "text-foreground after:bg-primary"
                  : "text-muted-foreground hover:text-foreground after:bg-transparent",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/** A small allowance meter: three bars filling up, the last one in the accent. */
function Mark() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
      <rect x="2" y="11" width="4" height="7" rx="1" className="fill-muted-foreground/50" />
      <rect x="8" y="7" width="4" height="11" rx="1" className="fill-muted-foreground/80" />
      <rect x="14" y="2" width="4" height="16" rx="1" className="fill-primary" />
    </svg>
  );
}

import { cn } from "@/lib/utils";

/**
 * A titled block of the page: every chart or list section uses it, so headings, spacing and
 * borders match. `actions` sits right of the title (toggles, tabs); `children` is the card body.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("rounded-xl border bg-card text-card-foreground", className)}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-[1_1_12rem]">
          <h2 id={headingId} className="text-sm font-medium">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

/**
 * An empty, clearly marked place for a section another ticket builds. That ticket replaces the
 * component file that renders this; the page already renders the component.
 */
export function SectionSlot({ title, ticket, children }: { title: string; ticket: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={`${title} (coming soon)`}
      className="flex min-h-40 flex-col justify-center gap-1 rounded-xl border border-dashed px-5 py-6"
    >
      <p className="text-sm font-medium text-muted-foreground">
        {title} <span className="font-mono text-xs font-normal text-muted-foreground/70">{ticket}</span>
      </p>
      <p className="max-w-prose text-[13px] text-muted-foreground/80">{children}</p>
    </section>
  );
}

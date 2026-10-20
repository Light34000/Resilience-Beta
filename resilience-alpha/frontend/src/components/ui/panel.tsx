import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface PanelProps {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Pas de marge interne : pour un tableau qui touche les bords. */
  flush?: boolean;
  headingLevel?: "h2" | "h3";
  id?: string;
  icon?: ReactNode;
}

/** Seul conteneur de l'interface : carte blanche, bordure fine. Ne pas imbriquer de Panel dans un Panel. */
export function Panel({ title, description, actions, children, className, flush, headingLevel = "h2", id, icon }: PanelProps) {
  const Heading = headingLevel;
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn("card relative min-w-0 overflow-hidden rounded-xl border border-border", className)}
    >
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {icon ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-tint text-primary [&_svg]:size-4">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? (
                <Heading id={headingId} className="text-[16px] leading-6 font-semibold text-fg">
                  {title}
                </Heading>
              ) : null}
              {description ? <p className="text-[13px] leading-5 text-fg-subtle">{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(!flush && "px-5 pb-5 lg:px-6 lg:pb-6", !flush && !(title || actions) && "pt-5 lg:pt-6")}>{children}</div>
    </section>
  );
}

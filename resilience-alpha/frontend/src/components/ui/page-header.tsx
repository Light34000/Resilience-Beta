import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  back,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Petit libellé au-dessus du titre, précédé d'un trait (rubrique). */
  eyebrow?: string;
}) {
  return (
    <header className="mb-8 flex animate-rise flex-col gap-4">
      {back ? (
        <Link
          href={back.href}
          className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg lg:min-h-0"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : eyebrow ? (
        <p className="flex items-center gap-3 text-[12px] font-semibold tracking-[0.08em] text-fg-muted uppercase">
          <span aria-hidden="true" className="h-px w-8 bg-gold" />
          {eyebrow}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-serif text-[30px] leading-[36px] font-semibold tracking-[-0.015em] text-fg sm:text-[34px] sm:leading-[40px]">
            {title}
          </h1>
          {description ? <p className="mt-2 max-w-2xl text-[15px] leading-6 text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
      </div>
    </header>
  );
}

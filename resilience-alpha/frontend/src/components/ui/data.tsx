import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { formatDateTime, formatMoney, shortId } from "@/lib/format";

import { CopyButton } from "./copy-button";

export function Money({ amount, currency, className }: { amount: string; currency: string; className?: string }) {
  return <span className={cn("tabular whitespace-nowrap", className)}>{formatMoney(amount, currency)}</span>;
}

export function Time({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={cn("tabular whitespace-nowrap", className)}>
      {formatDateTime(iso)}
    </time>
  );
}

/** Identifiant en police mono : raccourci à l'écran, valeur complète au survol et à la copie. */
export function Mono({ value, full = false, copy = false, className }: { value: string; full?: boolean; copy?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span title={full ? undefined : value} className={cn("font-mono text-[13px] text-fg-muted", full ? "break-all" : "whitespace-nowrap")}>
        {full ? value : shortId(value)}
      </span>
      {copy ? <CopyButton value={value} /> : null}
    </span>
  );
}

/** Liste de propriétés (détail d'un objet). */
export function DescriptionList({ items }: { items: { term: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-[minmax(140px,max-content)_1fr]">
      {items.map((item) => (
        <div key={item.term} className="contents">
          <dt className="text-[13px] font-medium text-fg-muted sm:py-0.5">{item.term}</dt>
          <dd className="-mt-3 min-w-0 text-fg sm:mt-0 sm:py-0.5">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

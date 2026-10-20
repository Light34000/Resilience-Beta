"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/cn";

import { Select } from "./field";
import { Spinner } from "./spinner";

export interface UrlSelectOption {
  value: string;
  label: string;
}

/** Filtre stocké dans l'URL : la vue est partageable et survit au retour arrière. Valeur vide = paramètre retiré. */
export function UrlSelect({
  name,
  label,
  value,
  options,
  className,
}: {
  name: string;
  label: string;
  value: string;
  options: UrlSelectOption[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2">
      <span className="text-[13px] font-medium whitespace-nowrap text-fg-muted">{label}</span>
      <Select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set(name, e.target.value);
          else next.delete(name);
          const qs = next.toString();
          startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
        }}
        aria-busy={pending || undefined}
        className={cn("w-auto lg:h-8 lg:text-[14px]", className)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {pending ? <Spinner className="text-fg-subtle" /> : null}
    </label>
  );
}

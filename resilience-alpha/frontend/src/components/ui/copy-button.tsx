"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

export function CopyButton({ value, label = "Copier l'identifiant" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors duration-120 hover:bg-surface-subtle hover:text-fg lg:size-7",
          copied && "text-success hover:text-success",
        )}
      >
        {copied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copié dans le presse-papiers" : ""}
      </span>
    </>
  );
}

"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LiveDot } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";
import { serviceLabel } from "@/lib/messages";
import { SERVICES, type HealthSnapshot } from "@/lib/types";

/** Bandeau d'état en direct (admin) : mêmes vérifications que la page Supervision, toutes les 10 s. */
export function LiveServices() {
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/bff/health", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as HealthSnapshot;
        if (alive) {
          setSnap(data);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    const first = setTimeout(check, 0);
    const t = setInterval(check, 10_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const down = snap?.services.filter((s) => s.state !== "up").length ?? 0;
  const summary = !snap
    ? failed
      ? "Vérification impossible"
      : "Vérification en cours…"
    : snap.gateway === "down"
      ? "Passerelle injoignable"
      : down === 0
        ? "Tous les services sont opérationnels"
        : `${down} service${down > 1 ? "s" : ""} indisponible${down > 1 ? "s" : ""}`;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <LiveDot tone={!snap ? "neutral" : down === 0 && snap.gateway === "up" ? "success" : "danger"} className="size-2.5" />
        <p className="font-medium text-fg" aria-live="polite">
          {summary}
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {SERVICES.map((name) => {
          const s = snap?.services.find((x) => x.service === name);
          const tone = !s ? "neutral" : s.state === "up" ? "success" : s.state === "down" ? "danger" : "neutral";
          return (
            <li
              key={name}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium",
                tone === "danger" ? "border-danger/40 bg-danger-tint text-danger" : "border-border bg-surface text-fg-muted",
              )}
            >
              <LiveDot tone={tone} />
              {serviceLabel(name)}
              <span className="sr-only">{!s ? " : inconnu" : s.state === "up" ? " : opérationnel" : " : indisponible"}</span>
              {s?.latencyMs != null && s.state === "up" ? <span className="tabular text-fg-subtle">{s.latencyMs} ms</span> : null}
            </li>
          );
        })}
      </ul>
      <Link
        href="/admin/system"
        className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-primary underline-offset-4 hover:underline lg:min-h-0"
      >
        Supervision
        <ArrowUpRight aria-hidden="true" className="size-4" />
      </Link>
    </div>
  );
}

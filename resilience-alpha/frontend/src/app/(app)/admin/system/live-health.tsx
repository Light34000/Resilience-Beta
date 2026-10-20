"use client";

import { Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { serviceLabel } from "@/lib/messages";
import { SERVICES, type HealthSnapshot, type ServiceName, type ServiceState } from "@/lib/types";

import { Topology } from "./topology";

const INTERVAL_MS = 5000;
const HISTORY = 24; // 2 minutes à 5 s
const INCIDENT_REFRESH_EVERY = 3; // rafraîchit les incidents (rendu serveur) toutes les 3 vérifications

interface Point {
  state: ServiceState;
  latencyMs: number | null;
  at: number;
}

type History = Record<ServiceName, Point[]>;

const emptyHistory = (): History =>
  Object.fromEntries(SERVICES.map((s) => [s, [] as Point[]])) as unknown as History;

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `il y a ${s} s`;
  return `il y a ${Math.floor(s / 60)} min ${(s % 60).toString().padStart(2, "0")} s`;
}

/** Bande d'historique : la forme distingue les états (barre pleine = opérationnel, cadre creux = indisponible). */
function Strip({ points }: { points: Point[] }) {
  const up = points.filter((p) => p.state === "up").length;
  const down = points.filter((p) => p.state === "down").length;
  const label =
    points.length === 0
      ? "Pas encore d'historique"
      : `Sur les ${points.length} dernières vérifications : ${up} opérationnelle${up > 1 ? "s" : ""}, ${down} indisponible${down > 1 ? "s" : ""}.`;
  const padded: (Point | null)[] = [...Array<null>(Math.max(0, HISTORY - points.length)).fill(null), ...points];
  return (
    <div role="img" aria-label={label} className="flex h-5 items-end gap-0.5">
      {padded.map((p, i) => (
        <span
          key={i}
          className={cn(
            "w-1.25 shrink-0 rounded-[1px]",
            p === null && "h-1 bg-hover",
            p?.state === "up" && "h-5 bg-success",
            p?.state === "down" && "h-5 border border-danger bg-danger-tint",
            p?.state === "unknown" && "h-2 bg-fg-subtle",
          )}
        />
      ))}
    </div>
  );
}

export function LiveHealth() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [history, setHistory] = useState<History>(emptyHistory);
  const [changedAt, setChangedAt] = useState<Partial<Record<ServiceName, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const tick = useRef(0);
  const prev = useRef<HealthSnapshot | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/bff/health", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (res.status === 401) {
        router.replace(`/login?expired=1&next=${encodeURIComponent("/admin/system")}`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snap = (await res.json()) as HealthSnapshot;
      const at = Date.parse(snap.checkedAt);

      const before = prev.current;
      const changes = snap.services.filter((s) => {
        const old = before?.services.find((o) => o.service === s.service);
        return !old || old.state !== s.state;
      });
      // La première observation n'est pas un changement : seules les transitions observées sont datées.
      if (before && changes.length) {
        setChangedAt((c) => {
          const next = { ...c };
          for (const s of changes) next[s.service] = at;
          return next;
        });
        setAnnouncement(
          changes.map((s) => `${serviceLabel(s.service)} : ${s.state === "up" ? "opérationnel" : s.state === "down" ? "indisponible" : "inconnu"}`).join(". "),
        );
      }
      prev.current = snap;
      setSnapshot(snap);
      setHistory((h) => {
        const next = { ...h };
        for (const s of snap.services) {
          next[s.service] = [...h[s.service], { state: s.state, latencyMs: s.latencyMs, at }].slice(-HISTORY);
        }
        return next;
      });
      setError(null);
      setLastOkAt(Date.now());

      // Un changement d'état ouvre ou clôt souvent un incident : on rafraîchit aussi la partie serveur.
      tick.current += 1;
      if ((before && changes.length) || tick.current % INCIDENT_REFRESH_EVERY === 0) router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.name === "TimeoutError" ? "Le serveur du front n'a pas répondu." : "Vérification impossible.");
    }
  }, [router]);

  useEffect(() => {
    if (paused) return;
    // Première vérification immédiate, puis toutes les 5 s.
    const first = setTimeout(check, 0);
    const t = setInterval(check, INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [paused, check]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stale = error !== null && snapshot !== null;

  return (
    <div className="flex flex-col">
      <Topology snapshot={snapshot} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 lg:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-2">
            <span className="text-[13px] font-medium text-fg-muted">Passerelle</span>
            {snapshot ? <StatusBadge status={snapshot.gateway === "up" ? "up" : "down"} /> : <Skeleton className="h-6 w-28" />}
          </span>
          <span className="text-[13px] text-fg-subtle tabular">
            {paused
              ? "En pause"
              : lastOkAt && now
                ? `Dernière vérification ${ago(now - lastOkAt)}`
                : "Première vérification…"}
          </span>
        </div>
        <Button size="sm" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {paused ? "Reprendre" : "Mettre en pause"}
        </Button>
      </div>

      {stale ? (
        <Alert tone="warning" title="Données possiblement périmées" className="mx-5 mt-4 lg:mx-6" role="status">
          {error} Le dernier état connu reste affiché.
        </Alert>
      ) : null}
      {error && !snapshot ? (
        <Alert tone="danger" title="Supervision indisponible" className="mx-5 mt-4 lg:mx-6" role="alert">
          {error}
        </Alert>
      ) : null}

      <Table caption="État des services vérifié depuis le front, toutes les 5 secondes">
        <THead>
          <tr>
            <TH>Service</TH>
            <TH>État</TH>
            <TH className="hidden text-right sm:table-cell">Latence</TH>
            <TH className="hidden lg:table-cell">Dernier changement</TH>
            <TH className="hidden lg:table-cell">2 dernières minutes</TH>
          </tr>
        </THead>
        <tbody>
          {SERVICES.map((service) => {
            const s = snapshot?.services.find((x) => x.service === service);
            const since = changedAt[service];
            return (
              <TR key={service}>
                <TD className="font-medium">{serviceLabel(service)}</TD>
                <TD>{s ? <StatusBadge status={s.state} /> : <Skeleton className="h-6 w-28" />}</TD>
                <TD className="tabular hidden text-right text-fg-muted sm:table-cell">
                  {s?.latencyMs != null && s.state !== "unknown" ? `${s.latencyMs} ms` : "—"}
                </TD>
                <TD className="tabular hidden text-fg-muted lg:table-cell">{since && now ? ago(now - since) : "—"}</TD>
                <TD className="hidden lg:table-cell">
                  <Strip points={history[service]} />
                </TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

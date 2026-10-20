import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Time } from "@/components/ui/data";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { getAuditEvents } from "@/lib/data";
import { formatDuration } from "@/lib/format";
import { serviceLabel } from "@/lib/messages";
import type { AuditEvent } from "@/lib/types";

import { LiveHealth } from "./live-health";

export const metadata: Metadata = { title: "Supervision" };

type Outcome = "active" | "resolved" | "failed" | "escalated" | "suppressed";

interface Incident {
  id: string;
  service: string;
  type: string | null;
  source: string | null;
  score: number | null;
  openedAt: string | null;
  closedAt: string | null;
  outcome: Outcome;
  duration: number | null;
}

const TERMINAL: Record<string, Outcome> = {
  incident_resolved: "resolved",
  incident_failed: "failed",
  incident_escalated: "escalated",
  incident_suppressed: "suppressed",
};

const TYPE_LABELS: Record<string, string> = {
  service_down: "Service arrêté",
  availability_degraded: "Disponibilité dégradée",
  anomaly: "Anomalie",
};

/** Reconstitue les incidents à partir de la piste d'audit du moteur de remédiation (seule trace exposée par la passerelle). */
function buildIncidents(events: AuditEvent[]): Incident[] {
  const map = new Map<string, Incident>();
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const d = e.details;
    const id = typeof d.incident_id === "string" ? d.incident_id : null;
    if (!id) continue;
    const inc =
      map.get(id) ??
      ({
        id,
        service: typeof d.service === "string" ? d.service : "?",
        type: null,
        source: null,
        score: null,
        openedAt: null,
        closedAt: null,
        outcome: "active",
        duration: null,
      } satisfies Incident);
    if (e.action === "incident_opened") {
      inc.openedAt = e.ts;
      inc.type = typeof d.type === "string" ? d.type : null;
      inc.source = typeof d.source === "string" ? d.source : null;
      inc.score = typeof d.score === "number" ? d.score : null;
    } else if (e.action in TERMINAL) {
      inc.outcome = TERMINAL[e.action];
      inc.closedAt = e.ts;
      inc.duration = typeof d.duration_seconds === "number" ? d.duration_seconds : null;
    }
    map.set(id, inc);
  }
  return [...map.values()].sort((a, b) => (b.openedAt ?? b.closedAt ?? "").localeCompare(a.openedAt ?? a.closedAt ?? ""));
}

async function Incidents() {
  const events = await getAuditEvents("remediation", null, 500);
  if (!events.ok) return <ErrorState error={events} service="audit" />;
  const incidents = buildIncidents(events.data);
  if (incidents.length === 0) {
    return (
      <EmptyState icon={ShieldCheck} title="Aucun incident enregistré">
        Quand la sonde ou le détecteur signale une panne, le moteur de remédiation ouvre un incident et l&apos;inscrit ici.
      </EmptyState>
    );
  }
  const active = incidents.filter((i) => i.outcome === "active").length;
  const resolved = incidents.filter((i) => i.outcome === "resolved" && i.duration !== null);
  const last = resolved[0];

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-b border-border px-4 py-4 sm:grid-cols-3 lg:px-5">
        <div>
          <dt className="text-[13px] font-medium text-fg-muted">En cours</dt>
          <dd className="tabular mt-0.5 text-[20px] font-semibold">{active}</dd>
        </div>
        <div>
          <dt className="text-[13px] font-medium text-fg-muted">Résolus</dt>
          <dd className="tabular mt-0.5 text-[20px] font-semibold">
            {incidents.filter((i) => i.outcome === "resolved").length} / {incidents.length}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] font-medium text-fg-muted">Dernière reprise prouvée</dt>
          <dd className="tabular mt-0.5 text-[20px] font-semibold">{last?.duration != null ? formatDuration(last.duration) : "—"}</dd>
        </div>
      </dl>
      <Table caption="Incidents de remédiation, du plus récent au plus ancien">
        <THead>
          <tr>
            <TH>Ouvert le</TH>
            <TH>Service</TH>
            <TH className="hidden xl:table-cell">Type</TH>
            <TH className="hidden xl:table-cell">Source</TH>
            <TH>Issue</TH>
            <TH className="text-right">Durée</TH>
          </tr>
        </THead>
        <tbody>
          {incidents.map((i) => (
            <TR key={i.id}>
              <TD>{i.openedAt ? <Time iso={i.openedAt} /> : i.closedAt ? <Time iso={i.closedAt} /> : "—"}</TD>
              <TD className="font-medium whitespace-nowrap">{serviceLabel(i.service)}</TD>
              <TD className="hidden whitespace-nowrap text-fg-muted xl:table-cell">
                {i.type ? (TYPE_LABELS[i.type] ?? i.type) : "—"}
              </TD>
              <TD className="hidden text-fg-muted xl:table-cell">
                {i.source ?? "—"}
                {i.score != null ? ` · score ${i.score}` : ""}
              </TD>
              <TD>
                <StatusBadge status={i.outcome as Status} />
              </TD>
              <TD className="tabular text-right text-fg-muted">{i.duration != null ? formatDuration(i.duration) : "—"}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </>
  );
}

export default function SystemPage() {
  return (
    <>
      <PageHeader
        eyebrow="Administration · en direct"
        title="Supervision"
        description="État des services et reprise autonome. Le tableau de bord Grafana reste la référence pour les métriques détaillées."
      />
      <div className="flex flex-col gap-6">
        <Panel
          title="Services"
          description="Vérifiés depuis ce front via la passerelle, toutes les 5 s. L'historique couvre la session ouverte uniquement."
          flush
        >
          <LiveHealth />
        </Panel>
        <Panel
          title="Incidents"
          description="Reconstitués depuis la piste d'audit du moteur de remédiation. Le détail étape par étape reste interne à la plateforme."
          flush
        >
          <Suspense fallback={<TableSkeleton rows={4} label="Chargement des incidents" />}>
            <Incidents />
          </Suspense>
        </Panel>
      </div>
    </>
  );
}

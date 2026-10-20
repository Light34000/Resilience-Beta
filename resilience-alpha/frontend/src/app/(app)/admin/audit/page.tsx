import { Bot, ScrollText, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ButtonLink } from "@/components/ui/button";
import { Mono, Time } from "@/components/ui/data";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { RetryButton } from "@/components/ui/retry-button";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { isStatus, StatusBadge } from "@/components/ui/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { UrlSelect } from "@/components/ui/url-select";
import { getAuditEvents, getCanaryIdentity, isUuid } from "@/lib/data";
import { AUDIT_ACTIONS, AUDIT_SERVICES, serviceLabel } from "@/lib/messages";

import { VerifyChain } from "./verify-chain";

export const metadata: Metadata = { title: "Journal d'audit" };

const LIMITS = ["100", "250", "500"];

// La plateforme ne sait pas exclure un acteur : en mode « sonde masquée », on lit le maximum (500) puis on filtre.
const MAX_READ = 500;

function ProbeNote({ hidden, read, kept, uuidFound }: { hidden: number; read: number; kept: number; uuidFound: boolean }) {
  return (
    <p className="border-b border-border px-4 py-2 text-[13px] leading-4.5 text-fg-subtle lg:px-5" aria-live="polite">
      Sonde masquée : {hidden.toLocaleString("fr-FR")} événement{hidden > 1 ? "s" : ""} de canary-bot retiré
      {hidden > 1 ? "s" : ""} sur les {read.toLocaleString("fr-FR")} derniers lus, {kept.toLocaleString("fr-FR")} affiché
      {kept > 1 ? "s" : ""}.
      {uuidFound ? null : " Identifiant de la sonde introuvable dans l'audit : seules ses connexions sont masquées."}
    </p>
  );
}

async function AuditTable({
  service,
  action,
  limit,
  hideProbe,
}: {
  service: string | null;
  action: string | null;
  limit: number;
  hideProbe: boolean;
}) {
  const [events, canary] = await Promise.all([
    getAuditEvents(service, action, hideProbe ? MAX_READ : limit),
    getCanaryIdentity(),
  ]);
  if (!events.ok) return <ErrorState error={events} service="audit" />;
  const isProbe = (actor: string | null) => actor !== null && canary.ids.has(actor);
  const rows = hideProbe ? events.data.filter((e) => !isProbe(e.actor)).slice(0, limit) : events.data;
  const note = hideProbe ? (
    <ProbeNote
      hidden={events.data.length - events.data.filter((e) => !isProbe(e.actor)).length}
      read={events.data.length}
      kept={rows.length}
      uuidFound={canary.uuidFound}
    />
  ) : null;

  if (rows.length === 0) {
    if (hideProbe && events.data.length > 0) {
      return (
        <>
          {note}
          <EmptyState
            icon={SearchX}
            title="Uniquement de l'activité de la sonde"
            action={
              <ButtonLink href={`/admin/audit?${new URLSearchParams({ ...(service ? { service } : {}), ...(action ? { action } : {}), probe: "show" })}`} size="sm">
                Afficher la sonde
              </ButtonLink>
            }
          >
            Les {events.data.length} derniers événements lus viennent tous de canary-bot.
          </EmptyState>
        </>
      );
    }
    return service || action ? (
      <EmptyState
        icon={SearchX}
        title="Aucun événement pour ces filtres"
        action={
          <ButtonLink href="/admin/audit" size="sm">
            Effacer les filtres
          </ButtonLink>
        }
      />
    ) : (
      <EmptyState icon={ScrollText} title="Journal vide">
        Les connexions, paiements et actions de remédiation y seront inscrits.
      </EmptyState>
    );
  }
  return (
    <>
      {note}
      <Table caption="Événements d'audit, du plus récent au plus ancien">
        <THead>
          <tr>
            <TH className="hidden text-right xl:table-cell">N°</TH>
            <TH>Date</TH>
            <TH>Service</TH>
            <TH>Action</TH>
            <TH className="hidden md:table-cell">Acteur</TH>
            <TH>Résultat</TH>
            <TH className="hidden xl:table-cell">Détails</TH>
          </tr>
        </THead>
        <tbody>
          {rows.map((e) => (
            <TR key={e.id} className="align-top">
              <TD className="tabular hidden text-right text-fg-muted xl:table-cell">{e.id}</TD>
              <TD>
                <Time iso={e.ts} />
              </TD>
              <TD className="whitespace-nowrap">{serviceLabel(e.service)}</TD>
              <TD>
                <span className="font-mono text-[13px] whitespace-nowrap">{e.action}</span>
              </TD>
              <TD className="hidden md:table-cell">
                {isProbe(e.actor) ? (
                  <span title={e.actor ?? undefined} className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-muted">
                    <Bot aria-hidden="true" className="size-4" strokeWidth={1.75} />
                    Sonde
                  </span>
                ) : e.actor ? (
                  isUuid(e.actor) ? <Mono value={e.actor} /> : <span>{e.actor}</span>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </TD>
              <TD>{isStatus(e.outcome) ? <StatusBadge status={e.outcome} /> : e.outcome}</TD>
              <TD className="hidden xl:table-cell">
                <details className="group max-w-90">
                  <summary className="inline-flex min-h-8 items-center text-[13px] font-medium text-primary marker:content-none">
                    <span className="group-open:hidden">Afficher</span>
                    <span className="hidden group-open:inline">Masquer</span>
                    <span className="sr-only"> les détails de l&apos;événement {e.id}</span>
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-surface-subtle p-2 font-mono text-[12px] leading-4.5 whitespace-pre-wrap text-fg-muted">
                    {JSON.stringify(e.details, null, 2)}
                    {"\n"}hash: {e.hash}
                  </pre>
                </details>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </>
  );
}

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const params = await searchParams;
  const service = AUDIT_SERVICES.find((s) => s === params.service) ?? null;
  const action = AUDIT_ACTIONS.find((a) => a === params.action) ?? null;
  const limitParam = LIMITS.find((l) => l === params.limit) ?? "100";
  // Sonde masquée par défaut : elle écrit un paiement toutes les 5 s et noie le reste.
  const hideProbe = params.probe !== "show";

  return (
    <>
      <PageHeader
        eyebrow="Administration · sécurité"
        title="Journal d'audit"
        description="Piste métier et sécurité en ajout seul : connexions, paiements, remédiations. La sonde (canary-bot) y inscrit un paiement de contrôle toutes les 5 s ; elle est masquée par défaut."
        actions={<RetryButton label="Actualiser" />}
      />
      <div className="flex flex-col gap-6">
        <Panel title="Intégrité de la chaîne">
          <VerifyChain />
        </Panel>
        <Panel flush>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 lg:px-5" role="group" aria-label="Filtres">
            <UrlSelect
              name="service"
              label="Service"
              value={service ?? ""}
              options={[{ value: "", label: "Tous" }, ...AUDIT_SERVICES.map((s) => ({ value: s, label: serviceLabel(s) }))]}
            />
            <UrlSelect
              name="action"
              label="Action"
              value={action ?? ""}
              options={[{ value: "", label: "Toutes" }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: a }))]}
            />
            <UrlSelect
              name="limit"
              label="Afficher"
              value={limitParam === "100" ? "" : limitParam}
              options={LIMITS.map((l) => ({ value: l === "100" ? "" : l, label: `${l} derniers` }))}
            />
            <UrlSelect
              name="probe"
              label="Sonde"
              value={hideProbe ? "" : "show"}
              options={[
                { value: "", label: "Masquée" },
                { value: "show", label: "Affichée" },
              ]}
            />
          </div>
          <Suspense
            key={`${service}-${action}-${limitParam}-${hideProbe}`}
            fallback={<TableSkeleton rows={10} label="Chargement du journal" />}
          >
            <AuditTable service={service} action={action} limit={Number(limitParam)} hideProbe={hideProbe} />
          </Suspense>
        </Panel>
      </div>
    </>
  );
}

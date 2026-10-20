import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { DescriptionList, Mono, Money, Time } from "@/components/ui/data";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { getAccounts, getPayment, isUuid } from "@/lib/data";
import { accountLabel } from "@/lib/format";
import { failureReason } from "@/lib/messages";
import type { Account } from "@/lib/types";

import { PendingRefresher } from "./pending-refresher";

export const metadata: Metadata = { title: "Paiement" };

function AccountLink({ id, own }: { id: string; own: Account[] }) {
  const account = own.find((a) => a.id === id);
  if (!account) return <Mono value={id} full copy />;
  return (
    <Link href={`/accounts/${id}`} className="font-medium text-primary underline-offset-4 hover:underline">
      {accountLabel(account)}
    </Link>
  );
}

export default async function PaymentPage({ params, searchParams }: PageProps<"/payments/[id]">) {
  const { id } = await params;
  const { r } = await searchParams;
  if (!isUuid(id)) notFound();

  const [payment, accounts] = await Promise.all([getPayment(id), getAccounts()]);
  if (!payment.ok) {
    if (payment.kind === "not_found") notFound();
    return (
      <>
        <PageHeader title="Paiement" back={{ href: "/payments", label: "Paiements" }} />
        <Panel>
          <ErrorState error={payment} service="payments" />
        </Panel>
      </>
    );
  }
  const p = payment.data;
  const own = accounts.ok ? accounts.data : [];

  return (
    <>
      <PageHeader
        title="Paiement"
        back={{ href: "/payments", label: "Paiements" }}
        actions={
          <ButtonLink href={`/payments/new?from=${p.from_account}`} variant="secondary">
            Nouveau paiement
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-6">
        <div aria-live="polite" className="flex flex-col gap-6">
          {p.status === "pending" ? (
            <Alert tone="warning" title="Paiement en cours de règlement" action={<PendingRefresher />}>
              La demande est enregistrée mais le service de comptes n&apos;a pas encore confirmé le transfert (panne ou reprise
              en cours). Le réconciliateur la rejoue automatiquement, sans double débit.
            </Alert>
          ) : null}
          {p.status === "completed" && (r === "created" || r === "pending") ? (
            <Alert tone="success" title="Paiement effectué" role="status">
              Les deux comptes ont été mis à jour dans une même transaction.
            </Alert>
          ) : null}
          {r === "replayed" ? (
            <Alert tone="info" title="Demande déjà reçue" role="status">
              Ce paiement avait déjà été envoyé avec la même clé d&apos;idempotence : aucun nouveau débit n&apos;a eu lieu.
            </Alert>
          ) : null}
          {p.status === "failed" ? (
            <Alert tone="danger" title="Paiement refusé" role="status">
              {failureReason(p.failure_reason)}
            </Alert>
          ) : null}
        </div>

        <Panel title="Détails">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-fg-muted">Montant</p>
                <p className="mt-1 text-[28px] leading-8.5 font-semibold tracking-[-0.01em]">
                  <Money amount={p.amount} currency={p.currency} />
                </p>
              </div>
              <StatusBadge status={p.status} />
            </div>
            <DescriptionList
              items={[
                { term: "Depuis", value: <AccountLink id={p.from_account} own={own} /> },
                { term: "Vers", value: <AccountLink id={p.to_account} own={own} /> },
                { term: "Créé le", value: <Time iso={p.created_at} /> },
                { term: "Mis à jour le", value: <Time iso={p.updated_at} /> },
                ...(p.failure_reason
                  ? [{ term: "Code de refus", value: <span className="font-mono text-[13px]">{p.failure_reason}</span> }]
                  : []),
                { term: "Identifiant", value: <Mono value={p.id} full copy /> },
              ]}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}

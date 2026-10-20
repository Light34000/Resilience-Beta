import { ArrowLeftRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PaymentsTable } from "@/components/features/payments-table";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { DescriptionList, Mono, Money, Time } from "@/components/ui/data";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { getAccount, getAccounts, getPayments, isUuid } from "@/lib/data";
import { accountLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Compte" };

async function AccountPayments({ accountId }: { accountId: string }) {
  const [payments, accounts] = await Promise.all([getPayments(200), getAccounts()]);
  if (!payments.ok) return <ErrorState error={payments} service="payments" />;
  const related = payments.data.filter((p) => p.from_account === accountId || p.to_account === accountId);
  if (related.length === 0) {
    return (
      <EmptyState icon={ArrowLeftRight} title="Aucun paiement initié avec ce compte">
        Les paiements reçus d&apos;autres utilisateurs ne sont pas listés : seule l&apos;écriture au solde les reflète.
      </EmptyState>
    );
  }
  return (
    <PaymentsTable payments={related} accounts={accounts.ok ? accounts.data : []} caption="Paiements liés à ce compte" />
  );
}

export default async function AccountPage({ params, searchParams }: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  const { r } = await searchParams;
  if (!isUuid(id)) notFound();

  const account = await getAccount(id);
  if (!account.ok) {
    if (account.kind === "not_found") notFound();
    return (
      <>
        <PageHeader title="Compte" back={{ href: "/accounts", label: "Comptes" }} />
        <Panel>
          <ErrorState error={account} service="accounts" />
        </Panel>
      </>
    );
  }
  const a = account.data;

  return (
    <>
      <PageHeader
        title={accountLabel(a)}
        back={{ href: "/accounts", label: "Comptes" }}
        actions={
          <ButtonLink href={`/payments/new?from=${a.id}`} variant="primary">
            <ArrowLeftRight aria-hidden="true" />
            Payer depuis ce compte
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-6">
        {r === "opened" ? (
          <Alert tone="success" title="Compte ouvert" role="status">
            Le solde initial a été inscrit au ledger comme une écriture de crédit.
          </Alert>
        ) : null}
        <Panel title="Détails">
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-[13px] font-medium text-fg-muted">Solde disponible</p>
              <p className="mt-1 text-[28px] leading-8.5 font-semibold tracking-[-0.01em]">
                <Money amount={a.balance} currency={a.currency} />
              </p>
            </div>
            <DescriptionList
              items={[
                {
                  term: "Identifiant",
                  value: <Mono value={a.id} full copy />,
                },
                { term: "Devise", value: a.currency },
                { term: "Ouvert le", value: <Time iso={a.created_at} /> },
              ]}
            />
            <p className="text-[13px] leading-4.5 text-fg-subtle">
              Pour recevoir un paiement, communiquez cet identifiant : la plateforme n&apos;a pas d&apos;annuaire de comptes.
            </p>
          </div>
        </Panel>
        <Panel title="Paiements" flush>
          <Suspense fallback={<TableSkeleton label="Chargement des paiements" />}>
            <AccountPayments accountId={a.id} />
          </Suspense>
        </Panel>
      </div>
    </>
  );
}

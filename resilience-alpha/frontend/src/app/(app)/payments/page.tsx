import { ArrowLeftRight, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PaymentsTable } from "@/components/features/payments-table";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { getAccounts, getPayments } from "@/lib/data";
import type { PaymentStatus } from "@/lib/types";

import { PaymentFilters } from "./payment-filters";

export const metadata: Metadata = { title: "Paiements" };

const STATUSES: PaymentStatus[] = ["completed", "pending", "failed"];

async function PaymentsList({ status, account }: { status: PaymentStatus | null; account: string | null }) {
  const [payments, accounts] = await Promise.all([getPayments(200), getAccounts()]);
  if (!payments.ok) return <ErrorState error={payments} service="payments" />;
  const own = accounts.ok ? accounts.data : [];

  const filtered = payments.data.filter(
    (p) => (!status || p.status === status) && (!account || p.from_account === account || p.to_account === account),
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 lg:px-5">
        <PaymentFilters accounts={own} status={status} account={account} />
        <p className="text-[13px] text-fg-subtle" aria-live="polite">
          {filtered.length} sur {payments.data.length} paiement{payments.data.length > 1 ? "s" : ""}
          {payments.data.length >= 200 ? " (200 derniers)" : ""}
        </p>
      </div>
      {payments.data.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Aucun paiement"
          action={
            <ButtonLink href="/payments/new" variant="primary" size="sm">
              Faire un paiement
            </ButtonLink>
          }
        >
          Les paiements que vous initiez apparaîtront ici.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Aucun paiement ne correspond aux filtres"
          action={
            <ButtonLink href="/payments" size="sm">
              Effacer les filtres
            </ButtonLink>
          }
        />
      ) : (
        <PaymentsTable payments={filtered} accounts={own} caption="Historique des paiements" />
      )}
    </>
  );
}

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const params = await searchParams;
  const status = STATUSES.find((s) => s === params.status) ?? null;
  const account = typeof params.account === "string" && params.account ? params.account : null;

  return (
    <>
      <PageHeader
        eyebrow="Espace client"
        title="Paiements"
        description="Paiements que vous avez initiés, du plus récent au plus ancien."
        actions={
          <ButtonLink href="/payments/new" variant="primary">
            <ArrowLeftRight aria-hidden="true" />
            Nouveau paiement
          </ButtonLink>
        }
      />
      <Panel flush>
        <Suspense key={`${status}-${account}`} fallback={<TableSkeleton rows={8} label="Chargement des paiements" />}>
          <PaymentsList status={status} account={account} />
        </Suspense>
      </Panel>
    </>
  );
}

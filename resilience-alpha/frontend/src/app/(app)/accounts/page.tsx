import { Plus, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountsTable } from "@/components/features/accounts-table";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { getAccounts } from "@/lib/data";

export const metadata: Metadata = { title: "Comptes" };

async function AccountsList() {
  const accounts = await getAccounts();
  if (!accounts.ok) return <ErrorState error={accounts} service="accounts" />;
  if (accounts.data.length === 0) {
    return (
      <EmptyState
        icon={Wallet}
        title="Aucun compte"
        action={
          <ButtonLink href="/accounts/new" variant="primary" size="sm">
            <Plus aria-hidden="true" />
            Ouvrir un compte
          </ButtonLink>
        }
      >
        Un compte reçoit un solde de démonstration à l&apos;ouverture.
      </EmptyState>
    );
  }
  return <AccountsTable accounts={accounts.data} />;
}

export default function AccountsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Espace client"
        title="Comptes"
        description="Les soldes sont tenus par un ledger : chaque mouvement est une écriture immuable."
        actions={
          <ButtonLink href="/accounts/new" variant="primary">
            <Plus aria-hidden="true" />
            Ouvrir un compte
          </ButtonLink>
        }
      />
      <Panel flush>
        <Suspense fallback={<TableSkeleton label="Chargement des comptes" />}>
          <AccountsList />
        </Suspense>
      </Panel>
    </>
  );
}

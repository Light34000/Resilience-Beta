import { Fingerprint, LockKeyhole, RotateCcw, ScanSearch, ShieldCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { getAccounts } from "@/lib/data";

import { PaymentForm } from "./payment-form";

export const metadata: Metadata = { title: "Nouveau paiement" };

const STEPS = [
  { icon: ScanSearch, title: "Vérification avant envoi", text: "Montant, comptes et clé affichés : rien ne part sans votre confirmation." },
  { icon: Fingerprint, title: "Clé d'idempotence", text: "Un nouvel essai du même paiement est reconnu : jamais de double débit." },
  { icon: LockKeyhole, title: "Règlement atomique", text: "Débit, crédit et écritures au ledger dans une seule transaction." },
  { icon: RotateCcw, title: "Reprise si un service tombe", text: "Paiement « en cours » rejoué automatiquement dès le retour du service." },
];

export default async function NewPaymentPage({ searchParams }: PageProps<"/payments/new">) {
  const { from } = await searchParams;
  const accounts = await getAccounts();

  let body;
  if (!accounts.ok) {
    body = <ErrorState error={accounts} service="accounts" />;
  } else if (accounts.data.length === 0) {
    body = (
      <EmptyState
        icon={Wallet}
        title="Aucun compte à débiter"
        action={
          <ButtonLink href="/accounts/new" variant="primary" size="sm">
            Ouvrir un compte
          </ButtonLink>
        }
      >
        Ouvrez d&apos;abord un compte pour pouvoir payer.
      </EmptyState>
    );
  } else {
    const initialFrom = typeof from === "string" && accounts.data.some((a) => a.id === from) ? from : accounts.data[0].id;
    // Une clé par intention de paiement, générée côté serveur et conservée pendant les nouveaux essais.
    body = <PaymentForm accounts={accounts.data} initialFrom={initialFrom} initialKey={crypto.randomUUID()} />;
  }

  return (
    <>
      <PageHeader
        title="Nouveau paiement"
        back={{ href: "/payments", label: "Paiements" }}
        description="Virement immédiat entre deux comptes de même devise."
      />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        <Panel>{body}</Panel>
        <Panel title="Un paiement protégé de bout en bout" icon={<ShieldCheck />} className="hidden xl:block">
          {/* Chaque étape décrit un comportement réel de la plateforme (payments + accounts). */}
          <ol className="relative flex flex-col gap-5">
            <span aria-hidden="true" className="absolute top-3 bottom-3 left-[17px] w-px bg-border" />
            {STEPS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="relative flex gap-4">
                <span className="relative z-[1] grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface text-primary">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <p className="font-medium text-fg">{title}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-fg-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}

import { Activity, ArrowLeftRight, Bell, Plus, Sparkles, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LiveServices } from "@/components/features/live-services";
import { PaymentsTable } from "@/components/features/payments-table";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Money, Time } from "@/components/ui/data";
import { Guilloche } from "@/components/ui/guilloche";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from "@/components/ui/states";
import { getAccounts, getNotifications, getPayments } from "@/lib/data";
import { sumAmounts } from "@/lib/format";
import { NOTIFICATION_KINDS } from "@/lib/messages";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Vue d'ensemble" };

const linkCls = "text-[13px] font-medium text-primary underline-offset-4 hover:underline";

async function Balances() {
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
        Ouvrez un compte pour recevoir un solde de démonstration et faire des paiements.
      </EmptyState>
    );
  }
  const byCurrency = new Map<string, string[]>();
  for (const a of accounts.data) byCurrency.set(a.currency, [...(byCurrency.get(a.currency) ?? []), a.balance]);
  const [[mainCurrency, mainBalances], ...others] = [...byCurrency.entries()].sort((a, b) => b[1].length - a[1].length);
  const total = sumAmounts(mainBalances);
  return (
    <div className="relative flex flex-col gap-6">
      {/* Guilloché discret dans l'angle de la carte, comme sur un relevé bancaire (masqué sur mobile). */}
      <Guilloche className="absolute -top-28 -right-36 hidden size-[420px] text-primary opacity-[0.16] md:block" rings={18} />
      <div>
        <p className="text-[14px] font-medium text-fg-muted">
          Solde total {mainCurrency} · {mainBalances.length} compte{mainBalances.length > 1 ? "s" : ""}
        </p>
        <p className="tabular mt-2 font-serif text-[44px] leading-none font-semibold tracking-[-0.02em] text-fg sm:text-[52px]">
          <Money amount={total} currency={mainCurrency} />
        </p>
        {others.length ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {others.map(([currency, balances]) => (
              <li key={currency} className="rounded-full border border-border bg-surface px-3 py-1 text-[13px] text-fg-muted">
                {currency} · <span className="tabular font-medium text-fg">{sumAmounts(balances)}</span> ({balances.length})
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2.5">
        <ButtonLink href="/payments/new" variant="primary">
          <ArrowLeftRight aria-hidden="true" />
          Nouveau paiement
        </ButtonLink>
        <ButtonLink href="/accounts/new">
          <Plus aria-hidden="true" />
          Ouvrir un compte
        </ButtonLink>
      </div>
    </div>
  );
}

async function ActivityTile() {
  const payments = await getPayments(200);
  if (!payments.ok) return <ErrorState error={payments} service="payments" />;
  const count = (s: string) => payments.data.filter((p) => p.status === s).length;
  const rows = [
    { key: "completed", label: "Effectués", value: count("completed"), bar: "bg-success" },
    { key: "pending", label: "En cours", value: count("pending"), bar: "bg-warning" },
    { key: "failed", label: "Refusés", value: count("failed"), bar: "bg-danger" },
  ];
  const total = payments.data.length;
  if (total === 0) {
    return (
      <EmptyState icon={ArrowLeftRight} title="Aucun paiement" className="py-6">
        Vos paiements apparaîtront ici.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <p className="font-serif text-[40px] leading-none font-semibold text-fg">
        {total.toLocaleString("fr-FR")}
        <span className="ml-2 font-sans text-[14px] font-medium text-fg-muted">paiement{total > 1 ? "s" : ""}</span>
      </p>
      {/* Barre de répartition : la longueur porte la proportion, le libellé et le nombre sont toujours écrits. */}
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
        {rows.map((r) => (r.value ? <span key={r.key} className={r.bar} style={{ width: `${(r.value / total) * 100}%` }} /> : null))}
      </div>
      <dl className="grid grid-cols-3 gap-3">
        {rows.map((r) => (
          <div key={r.key}>
            <dt className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
              <span aria-hidden="true" className={`size-2 rounded-full ${r.bar}`} />
              {r.label}
            </dt>
            <dd className="tabular mt-1 text-[20px] font-semibold">{r.value}</dd>
          </div>
        ))}
      </dl>
      {count("pending") ? (
        <Link href="/payments?status=pending" className={linkCls}>
          Voir les paiements en cours
        </Link>
      ) : null}
    </div>
  );
}

async function PendingNotice() {
  const payments = await getPayments(200);
  if (!payments.ok) return null;
  const pending = payments.data.filter((p) => p.status === "pending").length;
  if (pending === 0) return null;
  return (
    <Alert
      tone="warning"
      title={`${pending} paiement${pending > 1 ? "s" : ""} en attente`}
      role="status"
      action={
        <ButtonLink href="/payments?status=pending" size="sm">
          Voir
        </ButtonLink>
      }
    >
      Le service de comptes était indisponible au moment du paiement. Ils seront réglés automatiquement, sans double
      débit, dès son rétablissement.
    </Alert>
  );
}

async function RecentPayments() {
  const [payments, accounts] = await Promise.all([getPayments(200), getAccounts()]);
  if (!payments.ok) return <ErrorState error={payments} service="payments" />;
  if (payments.data.length === 0) {
    return (
      <EmptyState icon={ArrowLeftRight} title="Aucun paiement">
        Vos paiements apparaîtront ici.
      </EmptyState>
    );
  }
  return (
    <PaymentsTable payments={payments.data.slice(0, 6)} accounts={accounts.ok ? accounts.data : []} caption="Paiements récents" compact />
  );
}

async function RecentNotifications() {
  const notifications = await getNotifications(5);
  if (!notifications.ok) return <ErrorState error={notifications} service="notifications" />;
  if (notifications.data.length === 0) {
    return (
      <EmptyState icon={Bell} title="Aucune notification">
        Vous serez notifié à chaque paiement.
      </EmptyState>
    );
  }
  return (
    <ol className="relative flex flex-col gap-1 px-5 pb-5 lg:px-6">
      {/* Fil chronologique */}
      <span aria-hidden="true" className="absolute top-2 bottom-7 left-[27px] w-px bg-border lg:left-[31px]" />
      {notifications.data.map((n) => {
        const failed = n.kind === "payment_failed";
        return (
          <li key={n.id} className="relative flex gap-3 py-2">
            <span
              aria-hidden="true"
              className={`relative z-[1] mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--surface)] ${failed ? "bg-danger" : "bg-success"}`}
            />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg-muted">{NOTIFICATION_KINDS[n.kind] ?? n.kind}</p>
              <p className="mt-0.5 text-fg">{n.message}</p>
              <p className="mt-0.5 text-[12.5px] text-fg-subtle">
                <Time iso={n.created_at} />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default async function OverviewPage() {
  const session = await getSession();
  const hour = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", timeZone: "Europe/Paris" }).format(new Date()));
  const hello = hour < 18 ? "Bonjour" : "Bonsoir";
  return (
    <>
      <PageHeader
        eyebrow="Vue d'ensemble"
        title={
          <>
            {hello}, {session?.username}
          </>
        }
        description="Vos soldes, vos paiements et vos notifications, en temps réel depuis la plateforme."
      />
      <div className="flex flex-col gap-4">
        <Suspense fallback={null}>
          <PendingNotice />
        </Suspense>

        {session?.role === "admin" ? (
          <Panel className="animate-rise">
            <LiveServices />
          </Panel>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
          <Panel title="Soldes" icon={<Wallet />} className="animate-rise lg:col-span-4">
            <Suspense fallback={<Skeleton className="h-[140px] w-full max-w-md" />}>
              <Balances />
            </Suspense>
          </Panel>
          <Panel title="Activité" icon={<Activity />} className="animate-rise [animation-delay:80ms] lg:col-span-2">
            <Suspense fallback={<Skeleton className="h-[140px] w-full" />}>
              <ActivityTile />
            </Suspense>
          </Panel>

          <Panel
            title="Paiements récents"
            icon={<ArrowLeftRight />}
            flush
            className="animate-rise [animation-delay:120ms] lg:col-span-4"
            actions={
              <Link href="/payments" className={linkCls}>
                Historique
              </Link>
            }
          >
            <Suspense fallback={<TableSkeleton label="Chargement des paiements" />}>
              <RecentPayments />
            </Suspense>
          </Panel>
          <Panel
            title="Notifications"
            icon={<Sparkles />}
            flush
            className="animate-rise [animation-delay:160ms] lg:col-span-2"
            actions={
              <Link href="/notifications" className={linkCls}>
                Toutes
              </Link>
            }
          >
            <Suspense fallback={<TableSkeleton rows={4} label="Chargement des notifications" />}>
              <RecentNotifications />
            </Suspense>
          </Panel>
        </div>
      </div>
    </>
  );
}

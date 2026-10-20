import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Time } from "@/components/ui/data";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { RetryButton } from "@/components/ui/retry-button";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { getNotifications, isUuid } from "@/lib/data";
import { NOTIFICATION_KINDS } from "@/lib/messages";

export const metadata: Metadata = { title: "Notifications" };

async function NotificationsList() {
  const notifications = await getNotifications(100);
  if (!notifications.ok) return <ErrorState error={notifications} service="notifications" />;
  if (notifications.data.length === 0) {
    return (
      <EmptyState icon={Bell} title="Aucune notification">
        Une notification est envoyée à chaque paiement effectué ou refusé.
      </EmptyState>
    );
  }
  return (
    <ol className="divide-y divide-border">
      {notifications.data.map((n) => {
        const paymentId = typeof n.data.payment_id === "string" && isUuid(n.data.payment_id) ? n.data.payment_id : null;
        return (
          <li key={n.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-6 lg:px-5">
            <div className="w-40 shrink-0 pt-0.5">
              <StatusBadge
                status={n.kind === "payment_completed" ? "completed" : n.kind === "payment_failed" ? "failed" : "unknown"}
                label={NOTIFICATION_KINDS[n.kind] ?? n.kind}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-fg">{n.message}</p>
              <p className="mt-0.5 text-[13px] text-fg-subtle">
                <Time iso={n.created_at} /> · envoi simulé (e-mail)
              </p>
            </div>
            {paymentId ? (
              <Link
                href={`/payments/${paymentId}`}
                className="inline-flex min-h-11 items-center text-[13px] font-medium text-primary underline-offset-4 hover:underline sm:min-h-0 sm:pt-0.5"
              >
                Voir le paiement
              </Link>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Espace client"
        title="Notifications"
        description="100 dernières notifications. Elles arrivent juste après chaque paiement, sans mise à jour en temps réel."
        actions={<RetryButton label="Actualiser" />}
      />
      <Panel flush>
        <Suspense fallback={<TableSkeleton rows={6} label="Chargement des notifications" />}>
          <NotificationsList />
        </Suspense>
      </Panel>
    </>
  );
}

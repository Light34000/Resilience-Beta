import "server-only";

import { cache } from "react";

import { authed } from "./api";
import type { Account, AuditEvent, Notification, Payment } from "./types";

// Lectures mémoïsées le temps d'un rendu : plusieurs sections d'une page partagent la même requête.

export const getAccounts = cache(() => authed<Account[]>("/api/accounts/me"));

export const getAccount = cache((id: string) => authed<Account>(`/api/accounts/${encodeURIComponent(id)}`));

/** La plateforme plafonne à 200 : c'est l'historique complet visible par l'utilisateur. */
export const getPayments = cache((limit: number = 200) => authed<Payment[]>(`/api/payments?limit=${limit}`));

export const getPayment = cache((id: string) => authed<Payment>(`/api/payments/${encodeURIComponent(id)}`));

export const getNotifications = cache((limit: number = 50) =>
  authed<Notification[]>(`/api/notifications/me?limit=${limit}`),
);

export const getAuditEvents = cache((service: string | null, action: string | null, limit: number) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (service) q.set("service", service);
  if (action) q.set("action", action);
  return authed<AuditEvent[]>(`/api/audit/events?${q.toString()}`);
});

export const CANARY_USERNAME = "canary-bot";

/** Identités de la sonde synthétique dans l'audit : son nom (connexions) et son UUID (paiements, comptes).
 *  L'UUID n'est exposé par aucune API ; on le retrouve dans l'événement `user_registered` de canary-bot. */
export const getCanaryIdentity = cache(async (): Promise<{ ids: Set<string>; uuidFound: boolean }> => {
  const ids = new Set<string>([CANARY_USERNAME]);
  const res = await authed<AuditEvent[]>("/api/audit/events?action=user_registered&limit=500");
  if (!res.ok) return { ids, uuidFound: false };
  const reg = res.data.find((e) => e.actor === CANARY_USERNAME);
  const uuid = typeof reg?.details.user_id === "string" ? reg.details.user_id : null;
  if (uuid) ids.add(uuid);
  return { ids, uuidFound: uuid !== null };
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

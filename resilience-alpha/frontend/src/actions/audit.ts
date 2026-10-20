"use server";

import { authed } from "@/lib/api";
import type { AuditVerify } from "@/lib/types";

export type VerifyState =
  | { status: "idle" }
  | { status: "done"; result: AuditVerify; checkedAt: string }
  | { status: "error"; message: string };

/** Recalcule toute la chaîne de hachage côté service audit (jusqu'à 100 000 événements). */
export async function verifyAuditChain(): Promise<VerifyState> {
  const res = await authed<AuditVerify>("/api/audit/verify", { timeoutMs: 30000 });
  if (res.ok) return { status: "done", result: res.data, checkedAt: new Date().toISOString() };
  if (res.kind === "forbidden") return { status: "error", message: "Réservé au rôle administrateur." };
  if (res.kind === "unavailable" || res.kind === "unreachable" || res.kind === "timeout")
    return { status: "error", message: "Le service d'audit est indisponible ou n'a pas répondu à temps." };
  return { status: "error", message: res.message };
}

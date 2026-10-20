"use server";

import { redirect } from "next/navigation";

import { authed } from "@/lib/api";
import { isUuid } from "@/lib/data";
import { failureReason } from "@/lib/messages";
import type { Payment } from "@/lib/types";

type FieldName = "from_account" | "to_account" | "amount";

export interface PaymentFormState {
  /** "retry" : erreur transitoire, même clé d'idempotence conservée (un nouvel essai ne peut pas débiter deux fois).
   *  "rejected" : refus enregistré par la plateforme, la clé doit changer pour une nouvelle tentative. */
  outcome?: "invalid" | "retry" | "rejected";
  message?: string;
  requestId?: string | null;
  fieldErrors?: Partial<Record<FieldName, string>>;
  failedPaymentId?: string;
}

const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;

export async function createPayment(_prev: PaymentFormState, formData: FormData): Promise<PaymentFormState> {
  const from = String(formData.get("from_account") ?? "");
  const to = String(formData.get("to_account") ?? "").trim();
  const amount = String(formData.get("amount") ?? "").trim().replace(",", ".");
  const key = String(formData.get("idempotency_key") ?? "");
  // La plateforme enregistre EUR par défaut : on envoie la devise du compte source pour un historique exact.
  const currency = String(formData.get("currency") ?? "EUR");

  const fieldErrors: PaymentFormState["fieldErrors"] = {};
  if (!isUuid(from)) fieldErrors.from_account = "Choisissez le compte à débiter.";
  if (!isUuid(to)) fieldErrors.to_account = "Identifiant de compte invalide (format UUID).";
  else if (to === from) fieldErrors.to_account = "Le compte destinataire doit être différent du compte source.";
  if (!AMOUNT_RE.test(amount) || Number(amount) <= 0)
    fieldErrors.amount = "Montant positif, deux décimales au maximum (ex. 25.50).";
  if (key.length < 8 || key.length > 64) return { outcome: "retry", message: "Clé d'idempotence absente : rechargez la page." };
  if (!/^[A-Z]{3}$/.test(currency)) return { outcome: "invalid", fieldErrors: { from_account: "Devise du compte inconnue." } };
  if (Object.keys(fieldErrors).length) return { outcome: "invalid", fieldErrors };

  const res = await authed<Payment>("/api/payments", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: { from_account: from, to_account: to, amount, currency },
    timeoutMs: 15000,
  });

  if (res.ok) {
    const p = res.data;
    if (p.status === "failed") {
      return {
        outcome: "rejected",
        message: failureReason(p.failure_reason),
        failedPaymentId: p.id,
      };
    }
    redirect(`/payments/${p.id}?r=${res.status === 200 ? "replayed" : "created"}`);
  }

  // 503 : demande enregistrée, règlement en attente du ledger. Le détail suit le passage à « completed ».
  if (res.status === 503 && typeof res.detail === "object" && res.detail !== null) {
    const paymentId = (res.detail as { payment_id?: unknown }).payment_id;
    if (typeof paymentId === "string" && isUuid(paymentId)) redirect(`/payments/${paymentId}?r=pending`);
  }

  switch (res.kind) {
    case "validation": {
      const fe = res.fieldErrors;
      if (fe.from_account || fe.to_account || fe.amount) {
        return { outcome: "invalid", fieldErrors: { from_account: fe.from_account, to_account: fe.to_account, amount: fe.amount } };
      }
      // 422 métier : plafond dépassé ou comptes identiques (aucun paiement enregistré).
      return { outcome: "invalid", fieldErrors: { amount: res.message } };
    }
    case "conflict":
      return {
        outcome: "rejected",
        message: "Cette demande a déjà été envoyée avec d'autres valeurs. Vérifiez puis confirmez à nouveau.",
      };
    case "forbidden":
      return { outcome: "rejected", message: "Votre rôle ne permet pas d'effectuer un paiement." };
    case "unavailable":
    case "timeout":
    case "unreachable":
      return {
        outcome: "retry",
        message:
          "Le service de paiements n'a pas confirmé la demande (panne ou reprise en cours). Vous pouvez réessayer sans risque : la même clé d'idempotence empêche tout double débit.",
        requestId: res.requestId,
      };
    default:
      return { outcome: "retry", message: res.message, requestId: res.requestId };
  }
}

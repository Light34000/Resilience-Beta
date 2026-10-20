"use server";

import { redirect } from "next/navigation";

import { authed } from "@/lib/api";
import { CURRENCIES } from "@/lib/constants";
import type { Account } from "@/lib/types";

export interface OpenAccountState {
  message?: string;
  fieldErrors?: Partial<Record<"currency" | "initial_balance", string>>;
  values?: { currency: string; initial_balance: string };
}

const AMOUNT_RE = /^\d{1,6}(\.\d{1,2})?$/;

export async function openAccount(_prev: OpenAccountState, formData: FormData): Promise<OpenAccountState> {
  const currency = String(formData.get("currency") ?? "EUR");
  const initial = String(formData.get("initial_balance") ?? "").trim().replace(",", ".");
  const values = { currency, initial_balance: initial };

  const fieldErrors: OpenAccountState["fieldErrors"] = {};
  if (!(CURRENCIES as readonly string[]).includes(currency)) fieldErrors.currency = "Devise non proposée.";
  if (!AMOUNT_RE.test(initial) || Number(initial) > 100000)
    fieldErrors.initial_balance = "Montant entre 0 et 100 000, deux décimales au maximum.";
  if (fieldErrors.currency || fieldErrors.initial_balance) return { fieldErrors, values };

  const res = await authed<Account>("/api/accounts", {
    method: "POST",
    body: { currency, initial_balance: initial },
  });
  if (!res.ok) {
    if (res.kind === "validation") {
      return {
        fieldErrors: { currency: res.fieldErrors.currency, initial_balance: res.fieldErrors.initial_balance },
        values,
      };
    }
    if (res.kind === "unavailable" || res.kind === "timeout" || res.kind === "unreachable") {
      return {
        message: "Le service de comptes est indisponible ou en reprise. Aucun compte n'a été créé ; réessayez.",
        values,
      };
    }
    if (res.kind === "forbidden") return { message: "Votre rôle ne permet pas d'ouvrir un compte.", values };
    return { message: res.message, values };
  }
  redirect(`/accounts/${res.data.id}?r=opened`);
}

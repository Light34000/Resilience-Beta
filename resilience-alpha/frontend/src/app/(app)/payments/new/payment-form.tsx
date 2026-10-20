"use client";

import { ArrowRight, RotateCw } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { createPayment, type PaymentFormState } from "@/actions/payments";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { DescriptionList, Mono } from "@/components/ui/data";
import { Field, Input, Select } from "@/components/ui/field";
import { accountLabel, formatMoney } from "@/lib/format";
import type { Account } from "@/lib/types";

type Errors = Partial<Record<"from_account" | "to_account" | "amount", string>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;
const OTHER = "__other__";

function toCents(amount: string): bigint | null {
  if (!AMOUNT_RE.test(amount)) return null;
  const [w, f = ""] = amount.split(".");
  return BigInt(w) * BigInt(100) + BigInt((f + "00").slice(0, 2));
}

export function PaymentForm({
  accounts,
  initialFrom,
  initialKey,
}: {
  accounts: Account[];
  initialFrom: string;
  initialKey: string;
}) {
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [from, setFrom] = useState(initialFrom);
  const firstOther = accounts.find((a) => a.id !== initialFrom);
  const [toChoice, setToChoice] = useState<string>(firstOther ? firstOther.id : OTHER);
  const [toOther, setToOther] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [key, setKey] = useState(initialKey);
  const keyUsed = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction, pending] = useActionState<PaymentFormState, FormData>(async (prev, fd) => {
    keyUsed.current = true;
    const res = await createPayment(prev, fd);
    if (res.outcome === "invalid") {
      setErrors(res.fieldErrors ?? {});
      setStep("edit");
    } else if (res.outcome === "rejected") {
      // Refus enregistré : une nouvelle tentative est une nouvelle intention, donc une nouvelle clé.
      setKey(crypto.randomUUID());
      keyUsed.current = false;
      setStep("edit");
    }
    return res;
  }, {});

  const source = accounts.find((a) => a.id === from);
  const destinations = accounts.filter((a) => a.id !== from);
  const to = toChoice === OTHER ? toOther.trim() : toChoice;
  const ownDest = accounts.find((a) => a.id === to);
  const normalizedAmount = amount.trim().replace(",", ".");
  const cents = toCents(normalizedAmount);
  const balanceCents = source ? toCents(source.balance) : null;
  const exceedsBalance = cents !== null && balanceCents !== null && cents > balanceCents;

  // Toute modification après un envoi change l'intention : nouvelle clé d'idempotence.
  function edited() {
    if (keyUsed.current) {
      setKey(crypto.randomUUID());
      keyUsed.current = false;
    }
  }

  function validate(): Errors {
    const e: Errors = {};
    if (!source) e.from_account = "Choisissez le compte à débiter.";
    if (!UUID_RE.test(to)) e.to_account = "Saisissez un identifiant de compte valide (format UUID).";
    else if (to === from) e.to_account = "Le compte destinataire doit être différent du compte source.";
    if (cents === null || cents <= BigInt(0)) e.amount = "Montant positif, deux décimales au maximum (ex. 25.50).";
    return e;
  }

  function review() {
    const e = validate();
    setErrors(e);
    const first = (["from_account", "to_account", "amount"] as const).find((k) => e[k]);
    if (first) {
      const id = first === "to_account" && toChoice === OTHER ? "to_other" : first;
      document.getElementById(id)?.focus();
      return;
    }
    setStep("review");
  }

  useEffect(() => {
    if (step === "review") reviewHeading.current?.focus();
  }, [step]);

  // Après un retour serveur « invalide », focus sur le premier champ en erreur.
  useEffect(() => {
    if (state.outcome !== "invalid") return;
    const first = (["from_account", "to_account", "amount"] as const).find((k) => state.fieldErrors?.[k]);
    if (first) document.getElementById(first === "to_account" && toChoice === OTHER ? "to_other" : first)?.focus();
  }, [state, toChoice]);

  const currency = source?.currency ?? "EUR";

  return (
    <form ref={formRef} action={formAction} noValidate>
      <input type="hidden" name="from_account" value={from} />
      <input type="hidden" name="to_account" value={to} />
      <input type="hidden" name="amount" value={normalizedAmount} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="idempotency_key" value={key} />

      {step === "edit" ? (
        // Entrée dans un champ mène à la vérification, jamais directement à l'envoi.
        // Clés distinctes par étape : sinon React réutilise le bouton « Vérifier », qui devient « submit » pendant le
        // clic, et le formulaire part sans passer par la vérification.
        <div
          key="edit"
          className="flex flex-col gap-5"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              review();
            }
          }}
        >
          {state.outcome === "rejected" && state.message ? (
            <Alert
              tone="danger"
              title="Paiement refusé"
              role="alert"
              action={
                state.failedPaymentId ? (
                  <Link href={`/payments/${state.failedPaymentId}`} className={buttonClass("secondary", "sm")}>
                    Voir
                  </Link>
                ) : undefined
              }
            >
              {state.message}
            </Alert>
          ) : null}

          <Field
            id="from_account"
            label="Depuis"
            error={errors.from_account}
            helper={source ? `Solde disponible : ${formatMoney(source.balance, source.currency)}` : undefined}
          >
            {(aria) => (
              <Select
                {...aria}
                value={from}
                onChange={(e) => {
                  edited();
                  const next = e.target.value;
                  setFrom(next);
                  if (toChoice === next) setToChoice(accounts.find((a) => a.id !== next)?.id ?? OTHER);
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountLabel(a)} · {formatMoney(a.balance, a.currency)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            id="to_account"
            label="Vers"
            error={toChoice === OTHER ? undefined : errors.to_account}
            helper="Un de vos comptes, ou le compte d'une autre personne via son identifiant."
          >
            {(aria) => (
              <Select
                {...aria}
                value={toChoice}
                onChange={(e) => {
                  edited();
                  setToChoice(e.target.value);
                }}
              >
                {destinations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountLabel(a)}
                  </option>
                ))}
                <option value={OTHER}>Autre compte (saisir l&apos;identifiant)</option>
              </Select>
            )}
          </Field>

          {toChoice === OTHER ? (
            <Field id="to_other" label="Identifiant du compte destinataire" error={errors.to_account}>
              {(aria) => (
                <Input
                  {...aria}
                  value={toOther}
                  onChange={(e) => {
                    edited();
                    setToOther(e.target.value);
                  }}
                  onBlur={() => {
                    if (toOther && !UUID_RE.test(toOther.trim()))
                      setErrors((p) => ({ ...p, to_account: "Format attendu : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx." }));
                  }}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-[15px]"
                />
              )}
            </Field>
          ) : null}

          <Field id="amount" label={`Montant (${currency})`} error={errors.amount}>
            {(aria) => (
              <Input
                {...aria}
                value={amount}
                onChange={(e) => {
                  edited();
                  setAmount(e.target.value);
                }}
                onBlur={() => {
                  if (amount && toCents(amount.trim().replace(",", ".")) === null)
                    setErrors((p) => ({ ...p, amount: "Montant positif, deux décimales au maximum (ex. 25.50)." }));
                }}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className="tabular sm:max-w-60"
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-3 border-t border-border pt-5">
            <Button variant="primary" onClick={review}>
              Vérifier
              <ArrowRight aria-hidden="true" />
            </Button>
            <Link href="/payments" className={buttonClass("ghost")}>
              Annuler
            </Link>
          </div>
        </div>
      ) : (
        <div key="review" className="flex flex-col gap-5">
          <h2 ref={reviewHeading} tabIndex={-1} className="text-[15px] font-semibold outline-none">
            Vérifiez le paiement
          </h2>

          {state.outcome === "retry" && state.message ? (
            <Alert tone="danger" title="Paiement non confirmé" role="alert">
              {state.message}
              {state.requestId ? (
                <span className="mt-1 block">
                  Référence : <span className="font-mono">{state.requestId}</span>
                </span>
              ) : null}
            </Alert>
          ) : null}

          <div className="rounded-lg border border-border bg-surface-subtle px-4 py-4">
            <p className="text-[13px] font-medium text-fg-muted">Montant</p>
            <p className="tabular mt-1 text-[28px] leading-8.5 font-semibold tracking-[-0.01em]">
              {formatMoney(normalizedAmount, currency)}
            </p>
          </div>

          <DescriptionList
            items={[
              { term: "Depuis", value: source ? accountLabel(source) : from },
              {
                term: "Vers",
                value: ownDest ? accountLabel(ownDest) : <Mono value={to} full />,
              },
              {
                term: "Clé d'idempotence",
                value: (
                  <span className="flex flex-col gap-1">
                    <Mono value={key} full />
                    <span className="text-[13px] leading-4.5 text-fg-subtle">
                      Garantit qu&apos;un nouvel essai de ce paiement ne débite jamais deux fois.
                    </span>
                  </span>
                ),
              },
            ]}
          />

          {exceedsBalance ? (
            <Alert tone="warning" title="Montant supérieur au solde disponible" role="status">
              La plateforme refusera ce paiement pour solde insuffisant.
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-3 border-t border-border pt-5">
            <Button type="submit" variant="primary" loading={pending} loadingLabel="Envoi…">
              {state.outcome === "retry" ? (
                <>
                  <RotateCw aria-hidden="true" />
                  Réessayer
                </>
              ) : (
                "Confirmer le paiement"
              )}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setStep("edit")}>
              Modifier
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

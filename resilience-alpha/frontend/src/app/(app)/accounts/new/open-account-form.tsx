"use client";

import Link from "next/link";
import { useActionState } from "react";

import { openAccount, type OpenAccountState } from "@/actions/accounts";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { CURRENCIES } from "@/lib/constants";

export function OpenAccountForm() {
  const [state, action, pending] = useActionState<OpenAccountState, FormData>(openAccount, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.message ? (
        <Alert tone="danger" title="Compte non ouvert" role="alert">
          {state.message}
        </Alert>
      ) : null}
      <Field id="currency" label="Devise" error={state.fieldErrors?.currency}>
        {(aria) => (
          <Select {...aria} name="currency" defaultValue={state.values?.currency ?? "EUR"} className="sm:max-w-60">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id="initial_balance"
        label="Solde initial de démonstration"
        helper="Crédit fictif inscrit au ledger à l'ouverture (0 à 100 000). Fonction de démonstration, absente d'une vraie banque."
        error={state.fieldErrors?.initial_balance}
      >
        {(aria) => (
          <Input
            {...aria}
            name="initial_balance"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={state.values?.initial_balance ?? "1000.00"}
            className="tabular sm:max-w-60"
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Ouverture…">
          Ouvrir le compte
        </Button>
        <Link href="/accounts" className={buttonClass("ghost")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";

import { register, type AuthFormState } from "@/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import { PasswordInput } from "../password-input";

export function RegisterForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(register, {});
  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      {state.message ? (
        <Alert tone="danger" title="Inscription impossible" role="alert">
          {state.message}
        </Alert>
      ) : null}
      <Field
        id="username"
        label="Identifiant"
        helper="3 à 32 caractères : lettres, chiffres, point, tiret ou tiret bas."
        error={state.fieldErrors?.username}
      >
        {(aria) => (
          <Input
            {...aria}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9_.\-]+"
            defaultValue={state.values?.username}
            autoFocus
            required
          />
        )}
      </Field>
      <Field id="password" label="Mot de passe" helper="Entre 8 et 72 caractères." error={state.fieldErrors?.password}>
        {(aria) => (
          <PasswordInput {...aria} name="password" autoComplete="new-password" minLength={8} maxLength={72} required />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} loadingLabel="Création…" className="mt-2 w-full">
        Créer le compte
      </Button>
    </form>
  );
}

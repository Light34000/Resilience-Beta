"use client";

import { useActionState } from "react";

import { login, type AuthFormState } from "@/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import { PasswordInput } from "../password-input";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(login, {});
  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.message ? (
        <Alert tone="danger" title="Connexion impossible" role="alert">
          {state.message}
        </Alert>
      ) : null}
      <Field id="username" label="Identifiant" error={state.fieldErrors?.username}>
        {(aria) => (
          <Input
            {...aria}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={state.values?.username}
            autoFocus
            required
          />
        )}
      </Field>
      <Field id="password" label="Mot de passe" error={state.fieldErrors?.password}>
        {(aria) => <PasswordInput {...aria} name="password" autoComplete="current-password" required />}
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} loadingLabel="Connexion…" className="mt-2 w-full">
        Se connecter
      </Button>
    </form>
  );
}

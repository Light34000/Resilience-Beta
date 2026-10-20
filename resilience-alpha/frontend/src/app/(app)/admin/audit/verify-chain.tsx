"use client";

import { ShieldCheck } from "lucide-react";
import { useActionState } from "react";

import { verifyAuditChain, type VerifyState } from "@/actions/audit";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

export function VerifyChain() {
  const [state, action, pending] = useActionState<VerifyState>(verifyAuditChain, { status: "idle" });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-fg-muted">
          Chaque événement contient le hachage du précédent. Modifier ou supprimer une ligne casse la chaîne à partir de
          cet endroit.
        </p>
        <form action={action}>
          <Button type="submit" loading={pending} loadingLabel="Vérification…">
            <ShieldCheck aria-hidden="true" />
            Vérifier la chaîne
          </Button>
        </form>
      </div>
      <div aria-live="polite">
        {state.status === "done" ? (
          state.result.valid ? (
            <Alert tone="success" title="Chaîne intègre">
              {state.result.checked.toLocaleString("fr-FR")} événements recalculés, aucune altération. Vérifié le{" "}
              {formatDateTime(state.checkedAt)}.
            </Alert>
          ) : (
            <Alert tone="danger" title="Chaîne altérée">
              Premier événement invalide : n° {state.result.first_invalid_id}. {state.result.checked.toLocaleString("fr-FR")}{" "}
              événements lus. Conservez les preuves et ouvrez une investigation.
            </Alert>
          )
        ) : null}
        {state.status === "error" ? (
          <Alert tone="danger" title="Vérification impossible">
            {state.message}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

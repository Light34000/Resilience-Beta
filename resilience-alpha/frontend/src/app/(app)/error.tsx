"use client";

import { CircleAlert, RotateCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-4 py-14 text-center">
      <CircleAlert aria-hidden="true" className="size-6 text-danger" strokeWidth={1.75} />
      <div className="max-w-md">
        <h1 className="text-[17px] font-semibold text-fg">Cette page n&apos;a pas pu s&apos;afficher</h1>
        <p className="mt-1 text-[13px] leading-4.5 text-fg-muted">
          Une erreur inattendue s&apos;est produite côté front. Les données de la plateforme ne sont pas affectées.
        </p>
        {error.digest ? (
          <p className="mt-2 text-[12px] text-fg-subtle">
            Référence : <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
      <Button size="sm" onClick={() => retry()}>
        <RotateCw aria-hidden="true" />
        Réessayer
      </Button>
    </div>
  );
}

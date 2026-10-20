"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "./button";

/** Relance le rendu serveur de la page (nouvelle requête vers la plateforme). */
export function RetryButton({ label = "Réessayer" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button size="sm" loading={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? null : <RotateCw aria-hidden="true" />}
      {label}
    </Button>
  );
}

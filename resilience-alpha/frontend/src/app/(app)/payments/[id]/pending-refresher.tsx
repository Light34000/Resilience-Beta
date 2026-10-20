"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { Spinner } from "@/components/ui/spinner";

/** Recharge le paiement toutes les 5 s tant qu'il est « en cours » (la page serveur cesse de l'afficher ensuite). */
export function PendingRefresher() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const t = setInterval(() => startTransition(() => router.refresh()), 5000);
    return () => clearInterval(t);
  }, [router]);

  return (
    <span className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap text-fg-muted">
      {pending ? <Spinner /> : null}
      {pending ? "Vérification…" : "Actualisation toutes les 5 s"}
    </span>
  );
}

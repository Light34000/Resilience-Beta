import type { ReactNode } from "react";

/** Formulaire d'authentification : carte blanche, sobre. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="card rounded-xl border border-border p-7 sm:p-9">
      {children}
      <p className="mt-6 border-t border-border pt-5 text-center text-[13px] leading-5 text-fg-subtle">
        Plateforme de démonstration : comptes et montants fictifs, aucune donnée réelle.
      </p>
    </div>
  );
}

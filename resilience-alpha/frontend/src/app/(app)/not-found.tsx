import { SearchX } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-4 py-14 text-center">
      <SearchX aria-hidden="true" className="size-6 text-fg-subtle" strokeWidth={1.75} />
      <div className="max-w-sm">
        <h1 className="text-[17px] font-semibold text-fg">Introuvable</h1>
        <p className="mt-1 text-[13px] leading-4.5 text-fg-muted">
          Cette ressource n&apos;existe pas ou ne vous appartient pas.
        </p>
      </div>
      <ButtonLink href="/" size="sm">
        Retour à la vue d&apos;ensemble
      </ButtonLink>
    </div>
  );
}

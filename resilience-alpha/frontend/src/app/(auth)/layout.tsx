import { Radar, RotateCcw, ShieldCheck } from "lucide-react";

import { Brand } from "@/components/shell/brand";
import { Guilloche } from "@/components/ui/guilloche";

// Chaque promesse correspond à un comportement réel de la plateforme (voir README racine, sections 7 et 11).
const PROOFS = [
  { icon: Radar, title: "Détection en ~15 s", text: "Une sonde rejoue un vrai paiement toutes les 5 secondes." },
  { icon: RotateCcw, title: "Reprise prouvée", text: "Service redémarré, puis vérifié par une transaction réelle." },
  { icon: ShieldCheck, title: "Zéro double débit", text: "Clé d'idempotence et registre comptable immuable." },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Panneau marine : identité et promesse. Texte clair sur marine : contraste ≥ 8,8:1. */}
      <header className="relative isolate overflow-hidden bg-panel px-6 py-8 text-[#eceff4] sm:px-10 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        {/* Rosette estompée vers le texte (masque) pour ne jamais gêner la lecture. */}
        <Guilloche className="absolute -right-40 -bottom-48 -z-10 size-[620px] text-[#c8b27a] opacity-25 [mask-image:radial-gradient(circle_at_70%_70%,black_30%,transparent_70%)] lg:-right-40 lg:-bottom-40 lg:size-[760px] lg:opacity-60" />
        <Brand size="lg" tone="inverse" />
        <div className="mt-8 max-w-[30rem] lg:mt-0">
          <p className="flex items-center gap-3 text-[12px] font-semibold tracking-[0.12em] text-[#d4b574] uppercase">
            <span aria-hidden="true" className="h-px w-8 bg-[#d4b574]" />
            Plateforme de paiement résiliente
          </p>
          <h1 className="mt-4 font-serif text-[32px] leading-[1.12] font-semibold tracking-[-0.015em] sm:text-[42px] lg:text-[48px]">
            Des paiements qui se rétablissent d&apos;eux‑mêmes.
          </h1>
          <p className="mt-4 hidden text-[16px] leading-7 text-[#b8c4d8] sm:block">
            Une panne est détectée, le service fautif redémarré, puis la reprise est prouvée par un paiement réel et des
            soldes cohérents. Sans intervention humaine.
          </p>
        </div>
        <ul className="mt-10 hidden max-w-[34rem] grid-cols-3 gap-6 border-t border-[rgb(255_255_255/0.14)] pt-6 lg:grid">
          {PROOFS.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Icon aria-hidden="true" className="size-5 text-[#d4b574]" strokeWidth={1.75} />
              <p className="mt-3 text-[14px] font-semibold">{title}</p>
              <p className="mt-1 text-[13px] leading-5 text-[#b8c4d8]">{text}</p>
            </li>
          ))}
        </ul>
      </header>

      <main id="main" className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px] animate-rise">{children}</div>
      </main>
    </div>
  );
}

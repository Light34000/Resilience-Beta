import { ButtonLink } from "@/components/ui/button";
import { Brand } from "@/components/shell/brand";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brand />
      <div>
        <h1 className="text-[20px] font-semibold text-fg">Page introuvable</h1>
        <p className="mt-1 text-fg-muted">L&apos;adresse demandée n&apos;existe pas.</p>
      </div>
      <ButtonLink href="/" variant="primary">
        Aller à l&apos;accueil
      </ButtonLink>
    </main>
  );
}

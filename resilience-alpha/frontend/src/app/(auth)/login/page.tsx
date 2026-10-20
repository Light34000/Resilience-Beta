import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { safeNext } from "@/lib/claims";

import { AuthCard } from "../auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : "/");
  return (
    <AuthCard>
      <h2 className="font-serif text-[28px] leading-9 font-semibold tracking-[-0.01em] text-fg">Connexion</h2>
      <p className="mt-1.5 text-fg-muted">Accédez à vos comptes, paiements et à la supervision.</p>

      {params.expired === "1" ? (
        <Alert tone="warning" title="Session expirée" className="mt-5" role="status">
          Les sessions durent 15 minutes. Reconnectez-vous pour continuer.
        </Alert>
      ) : null}
      {params.registered === "1" ? (
        <Alert tone="success" title="Compte créé" className="mt-5" role="status">
          Connectez-vous avec votre nouvel identifiant.
        </Alert>
      ) : null}

      <LoginForm next={next} />

      <p className="mt-7 border-t border-border pt-6 text-center text-fg-muted">
        Pas encore de compte ?{" "}
        <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
          Créer un compte
        </Link>
      </p>
    </AuthCard>
  );
}

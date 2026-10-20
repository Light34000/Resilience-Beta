import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "../auth-card";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Créer un compte" };

export default function RegisterPage() {
  return (
    <AuthCard>
      <h2 className="font-serif text-[28px] leading-9 font-semibold tracking-[-0.01em] text-fg">Créer un compte</h2>
      <p className="mt-1.5 text-fg-muted">Ouvrez ensuite des comptes et faites des paiements fictifs.</p>
      <RegisterForm />
      <p className="mt-7 border-t border-border pt-6 text-center text-fg-muted">
        Déjà inscrit ?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Se connecter
        </Link>
      </p>
    </AuthCard>
  );
}

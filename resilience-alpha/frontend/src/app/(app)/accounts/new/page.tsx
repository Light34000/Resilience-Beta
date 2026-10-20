import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";

import { OpenAccountForm } from "./open-account-form";

export const metadata: Metadata = { title: "Ouvrir un compte" };

export default function NewAccountPage() {
  return (
    <>
      <PageHeader
        title="Ouvrir un compte"
        back={{ href: "/accounts", label: "Comptes" }}
        description="Le compte est ouvert à votre nom. Les paiements ne sont possibles qu'entre comptes de même devise."
      />
      <Panel className="max-w-140">
        <OpenAccountForm />
      </Panel>
    </>
  );
}

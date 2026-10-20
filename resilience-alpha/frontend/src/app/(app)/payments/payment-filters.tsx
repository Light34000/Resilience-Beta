import { UrlSelect } from "@/components/ui/url-select";
import { accountLabel } from "@/lib/format";
import type { Account } from "@/lib/types";

export function PaymentFilters({
  accounts,
  status,
  account,
}: {
  accounts: Account[];
  status: string | null;
  account: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Filtres">
      <UrlSelect
        name="status"
        label="Statut"
        value={status ?? ""}
        className="min-w-37.5"
        options={[
          { value: "", label: "Tous" },
          { value: "completed", label: "Effectués" },
          { value: "pending", label: "En cours" },
          { value: "failed", label: "En échec" },
        ]}
      />
      <UrlSelect
        name="account"
        label="Compte"
        value={account ?? ""}
        className="min-w-47.5"
        options={[{ value: "", label: "Tous les comptes" }, ...accounts.map((a) => ({ value: a.id, label: accountLabel(a) }))]}
      />
    </div>
  );
}

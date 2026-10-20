import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Money, Time } from "@/components/ui/data";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { accountLabel, shortId } from "@/lib/format";
import { failureReason } from "@/lib/messages";
import type { Account, Payment } from "@/lib/types";

/** Libellé d'un compte : nom lisible si c'est un compte de l'utilisateur, sinon identifiant raccourci. */
function AccountRef({ id, own }: { id: string; own: Map<string, Account> }) {
  const account = own.get(id);
  if (account) return <span className="whitespace-nowrap">{accountLabel(account)}</span>;
  return (
    <span title={id} className="font-mono text-[13px] whitespace-nowrap text-fg-muted">
      {shortId(id)}
    </span>
  );
}

export function PaymentsTable({
  payments,
  accounts,
  caption,
  compact = false,
}: {
  payments: Payment[];
  accounts: Account[];
  caption: string;
  compact?: boolean;
}) {
  const own = new Map(accounts.map((a) => [a.id, a]));
  return (
    <Table caption={caption}>
      <THead>
        <tr>
          <TH>Date</TH>
          <TH className="hidden md:table-cell">Trajet</TH>
          <TH className="text-right">Montant</TH>
          <TH className="hidden md:table-cell">Statut</TH>
          {compact ? null : <TH className="hidden xl:table-cell">Détail</TH>}
        </tr>
      </THead>
      <tbody>
        {payments.map((p) => {
          const route = (
            <span className="flex flex-wrap items-center gap-x-1.5">
              <AccountRef id={p.from_account} own={own} />
              <ArrowRight aria-label="vers" className="size-3.5 shrink-0 text-fg-subtle" />
              <AccountRef id={p.to_account} own={own} />
            </span>
          );
          return (
            <TR key={p.id}>
              <TD className="py-1 md:py-0">
                <Link
                  href={`/payments/${p.id}`}
                  className="inline-flex min-h-11 items-center font-medium text-fg underline-offset-4 hover:text-primary hover:underline lg:min-h-0"
                >
                  <Time iso={p.created_at} />
                </Link>
                {/* Sur téléphone : deux colonnes, le trajet sous la date, le statut sous le montant. */}
                <div className="-mt-2 pb-1 text-[13px] text-fg-muted md:hidden">{route}</div>
              </TD>
              <TD className="hidden md:table-cell">{route}</TD>
              <TD className="py-2 text-right font-medium md:py-0">
                <Money amount={p.amount} currency={p.currency} />
                <div className="mt-1 md:hidden">
                  <StatusBadge status={p.status} />
                </div>
              </TD>
              <TD className="hidden md:table-cell">
                <StatusBadge status={p.status} />
              </TD>
              {compact ? null : (
                <TD className="hidden max-w-70 truncate text-fg-muted xl:table-cell">
                  {p.status === "failed" ? failureReason(p.failure_reason) : p.status === "pending" ? "En attente du ledger" : ""}
                </TD>
              )}
            </TR>
          );
        })}
      </tbody>
    </Table>
  );
}

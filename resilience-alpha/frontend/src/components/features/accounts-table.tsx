import Link from "next/link";

import { Mono, Money, Time } from "@/components/ui/data";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { accountLabel } from "@/lib/format";
import type { Account } from "@/lib/types";

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  return (
    <Table caption="Vos comptes">
      <THead>
        <tr>
          <TH>Compte</TH>
          <TH className="hidden sm:table-cell">Identifiant</TH>
          <TH className="hidden md:table-cell">Ouvert le</TH>
          <TH className="text-right">Solde</TH>
        </tr>
      </THead>
      <tbody>
        {accounts.map((a) => (
          <TR key={a.id}>
            <TD>
              <Link
                href={`/accounts/${a.id}`}
                className="inline-flex min-h-11 items-center font-medium text-fg underline-offset-4 hover:text-primary hover:underline lg:min-h-0"
              >
                {accountLabel(a)}
              </Link>
            </TD>
            <TD className="hidden sm:table-cell">
              <Mono value={a.id} copy />
            </TD>
            <TD className="hidden text-fg-muted md:table-cell">
              <Time iso={a.created_at} />
            </TD>
            <TD className="text-right font-medium">
              <Money amount={a.balance} currency={a.currency} />
            </TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}

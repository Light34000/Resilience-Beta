import { PermissionState } from "@/components/ui/states";
import { getSession } from "@/lib/session";

/** Les services vérifient le rôle à chaque appel ; ici on évite d'afficher une page vide à un client. */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await getSession();
  if (session?.role !== "admin") return <PermissionState role="administrateur" />;
  return children;
}

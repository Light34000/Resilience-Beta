import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/shell/nav";
import { OfflineBanner } from "@/components/shell/offline-banner";
import type { ThemeChoice } from "@/components/shell/theme-toggle";
import { currentPath, getSession } from "@/lib/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(await currentPath())}`);
  const theme: ThemeChoice = (await cookies()).get("ra_theme")?.value === "dark" ? "dark" : "light";

  return (
    <div className="relative isolate min-h-dvh lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-fg focus:shadow-overlay"
      >
        Aller au contenu
      </a>
      <AppNav user={{ username: session.username, role: session.role, exp: session.exp }} theme={theme} />
      <OfflineBanner />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] px-4 py-8 outline-none md:px-8 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}

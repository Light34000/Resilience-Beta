"use client";

import {
  Activity,
  ArrowLeftRight,
  Bell,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { logout } from "@/actions/auth";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/types";

import { Brand } from "./brand";
import { SessionClock, useSessionExpiry } from "./session-clock";
import { applyTheme, ThemeToggle, type ThemeChoice } from "./theme-toggle";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
}

const MAIN: Item[] = [
  { href: "/", label: "Vue d'ensemble", icon: LayoutDashboard },
  { href: "/accounts", label: "Comptes", icon: Wallet },
  { href: "/payments", label: "Paiements", icon: ArrowLeftRight },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

const ADMIN: Item[] = [
  { href: "/admin/system", label: "Supervision", icon: Activity },
  { href: "/admin/audit", label: "Journal d'audit", icon: ScrollText },
];

export interface NavUser {
  username: string;
  role: Role;
  exp: number;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ items, pathname }: { items: Item[]; pathname: string }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors duration-150 lg:h-10",
                active ? "bg-primary-tint text-primary" : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-primary"
                />
              ) : null}
              <Icon
                aria-hidden="true"
                className={cn("size-5 shrink-0 lg:size-4.5", active ? "text-primary" : "text-fg-subtle group-hover:text-fg-muted")}
                strokeWidth={1.75}
              />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

interface NavBodyProps {
  user: NavUser;
  theme: ThemeChoice;
  onTheme: (next: ThemeChoice) => void;
  pathname: string;
}

function NavBody({ user, theme, onTheme, pathname }: NavBodyProps) {
  const initials = user.username.slice(0, 2).toUpperCase();
  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-5">
        <p className="px-3 pb-2 text-[12px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">Espace client</p>
        <NavLinks items={MAIN} pathname={pathname} />
        {user.role === "admin" ? (
          <div className="mt-7">
            <p className="px-3 pb-2 text-[12px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">Administration</p>
            <NavLinks items={ADMIN} pathname={pathname} />
          </div>
        ) : null}
      </nav>
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-solid text-[12px] font-semibold text-on-primary"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-fg" title={user.username}>
              {user.username}
            </p>
            <p className="text-[12px] leading-4 text-fg-subtle">
              {user.role === "admin" ? "Administrateur" : "Client"} · <SessionClock exp={user.exp} />
            </p>
          </div>
        </div>
        <ThemeToggle theme={theme} onChange={onTheme} />
        <form action={logout}>
          <button
            type="submit"
            className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[14px] font-medium text-fg-muted transition-colors duration-150 hover:bg-danger-tint hover:text-danger lg:h-9"
          >
            <LogOut aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
            Se déconnecter
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppNav({ user, theme: initialTheme }: { user: NavUser; theme: ThemeChoice }) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [theme, setTheme] = useState<ThemeChoice>(initialTheme);
  const onTheme = (next: ThemeChoice) => {
    applyTheme(next);
    setTheme(next);
  };
  useSessionExpiry(user.exp);

  // Le tiroir mobile se ferme quand la page change.
  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  return (
    <>
      {/* Bureau : barre latérale fixe */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-border px-6">
          <Link href="/" aria-label="Resilience Alpha, vue d'ensemble">
            <Brand />
          </Link>
        </div>
        <NavBody user={user} theme={theme} onTheme={onTheme} pathname={pathname} />
      </aside>

      {/* Mobile et tablette : barre supérieure + tiroir */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-surface px-2 lg:hidden">
        <button
          type="button"
          aria-label="Ouvrir le menu"
          aria-haspopup="dialog"
          onClick={() => dialogRef.current?.showModal()}
          className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>
        <Link href="/" aria-label="Resilience Alpha, vue d'ensemble" className="inline-flex min-h-11 items-center">
          <Brand />
        </Link>
        <span className="size-11" aria-hidden="true" />
      </header>

      <dialog
        ref={dialogRef}
        aria-label="Menu"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="m-0 h-dvh max-h-dvh w-[min(320px,85vw)] max-w-none border-r border-border bg-surface p-0 text-fg backdrop:bg-scrim backdrop:backdrop-blur-sm lg:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border pr-2 pl-5">
            <Brand />
            <button
              type="button"
              aria-label="Fermer le menu"
              onClick={() => dialogRef.current?.close()}
              className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <NavBody user={user} theme={theme} onTheme={onTheme} pathname={pathname} />
          </div>
        </div>
      </dialog>
    </>
  );
}

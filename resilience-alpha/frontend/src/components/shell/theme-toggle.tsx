"use client";

import { Moon, Sun } from "lucide-react";

export type ThemeChoice = "dark" | "light";

const LABEL: Record<ThemeChoice, string> = { dark: "Sombre", light: "Clair" };

/** Applique le thème et le mémorise dans un cookie lu par le layout racine (pas de flash au chargement). */
export function applyTheme(next: ThemeChoice) {
  document.documentElement.dataset.theme = next;
  document.cookie = `ra_theme=${next}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeToggle({ theme, onChange }: { theme: ThemeChoice; onChange: (next: ThemeChoice) => void }) {
  const next: ThemeChoice = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={`Thème : ${LABEL[theme]}. Passer au thème ${LABEL[next].toLowerCase()}`}
      className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[14px] font-medium text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg lg:h-9"
    >
      <Icon aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
      Thème {LABEL[theme].toLowerCase()}
    </button>
  );
}

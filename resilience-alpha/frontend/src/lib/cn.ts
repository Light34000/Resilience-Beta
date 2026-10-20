import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge doit connaître les couleurs du thème (palette par défaut désactivée).
const merge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "bg",
        "surface",
        "surface-subtle",
        "border",
        "border-strong",
        "fg",
        "fg-muted",
        "fg-subtle",
        "primary",
        "primary-hover",
        "on-primary",
        "primary-tint",
        "success",
        "success-tint",
        "warning",
        "warning-tint",
        "danger",
        "danger-tint",
        "scrim",
        "glass",
        "glass-strong",
        "primary-from",
        "primary-to",
        "live",
        "live-tint",
        "glow",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}

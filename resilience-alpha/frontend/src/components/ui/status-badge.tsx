import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleX,
  Clock,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";

export type Status =
  | "completed"
  | "pending"
  | "failed"
  | "up"
  | "down"
  | "unknown"
  | "active"
  | "resolved"
  | "escalated"
  | "suppressed"
  | "success"
  | "failure"
  | "denied";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const STATUS: Record<Status, { label: string; tone: Tone; icon: LucideIcon }> = {
  completed: { label: "Effectué", tone: "success", icon: CircleCheck },
  pending: { label: "En cours", tone: "warning", icon: Clock },
  failed: { label: "Échec", tone: "danger", icon: CircleX },
  up: { label: "Opérationnel", tone: "success", icon: CircleCheck },
  down: { label: "Indisponible", tone: "danger", icon: CircleX },
  unknown: { label: "Inconnu", tone: "neutral", icon: CircleHelp },
  active: { label: "En traitement", tone: "info", icon: CircleDot },
  resolved: { label: "Résolu", tone: "success", icon: CircleCheck },
  escalated: { label: "Escaladé", tone: "warning", icon: ShieldAlert },
  suppressed: { label: "Bloqué (disjoncteur)", tone: "warning", icon: CircleAlert },
  success: { label: "Succès", tone: "success", icon: CircleCheck },
  failure: { label: "Échec", tone: "danger", icon: CircleX },
  denied: { label: "Refusé", tone: "warning", icon: CircleAlert },
};

const TONES: Record<Tone, string> = {
  success: "border-transparent bg-success-tint text-success",
  warning: "border-transparent bg-warning-tint text-warning",
  danger: "border-transparent bg-danger-tint text-danger",
  info: "border-transparent bg-primary-tint text-primary",
  neutral: "border-border bg-surface-subtle text-fg-muted",
};

export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const def = STATUS[status] ?? { label: status, tone: "neutral" as Tone, icon: CircleDashed };
  const Icon = def.icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] leading-none font-medium whitespace-nowrap",
        TONES[def.tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
      {label ?? def.label}
    </span>
  );
}

/** Point lumineux avec onde (état en direct). La couleur n'est jamais seule : toujours à côté d'un libellé. */
export function LiveDot({ tone = "success", className }: { tone?: "success" | "danger" | "warning" | "live" | "neutral"; className?: string }) {
  const color = {
    success: "bg-success",
    danger: "bg-danger",
    warning: "bg-warning",
    live: "bg-live",
    neutral: "bg-fg-subtle",
  }[tone];
  return (
    <span aria-hidden="true" className={cn("relative inline-flex size-2", className)}>
      {tone !== "neutral" ? <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", color)} /> : null}
      <span className={cn("relative size-2 rounded-full", color)} />
    </span>
  );
}

export function isStatus(value: string): value is Status {
  return value in STATUS;
}

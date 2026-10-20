import { CircleAlert, CloudOff, Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { serviceLabel } from "@/lib/messages";

import { RetryButton } from "./retry-button";

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-4 py-12 text-center", className)}>
      <span className="grid size-12 place-items-center rounded-xl border border-border bg-primary-tint text-primary">
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <div className="max-w-sm">
        <p className="font-medium text-fg">{title}</p>
        {children ? <p className="mt-1 text-[13px] leading-4.5 text-fg-muted">{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

function describe(error: ApiError, service: string): { title: string; body: string } {
  const name = serviceLabel(service);
  switch (error.kind) {
    case "unreachable":
      return { title: "Plateforme injoignable", body: "La passerelle ne répond pas. Vérifiez que la pile est démarrée." };
    case "timeout":
      return { title: `${name} ne répond pas`, body: "Le service a dépassé le délai de réponse." };
    case "unavailable":
      return {
        title: `Service ${name} indisponible`,
        body: "Le service est en panne ou en cours de reprise. La remédiation automatique doit le rétablir.",
      };
    case "forbidden":
      return { title: "Accès refusé", body: "Votre rôle ne permet pas de consulter ces données." };
    case "not_found":
      return { title: "Introuvable", body: "Cette ressource n'existe pas ou ne vous appartient pas." };
    default:
      return { title: `Erreur du service ${name}`, body: error.message };
  }
}

/** État d'erreur d'une section : quel service, pourquoi, comment réessayer, et la référence de la requête. */
export function ErrorState({ error, service, className }: { error: ApiError; service: string; className?: string }) {
  const { title, body } = describe(error, service);
  const Icon = error.kind === "unreachable" || error.kind === "unavailable" ? CloudOff : CircleAlert;
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 px-4 py-12 text-center", className)}>
      <span className="grid size-12 place-items-center rounded-xl border border-danger/30 bg-danger-tint text-danger">
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <div className="max-w-md">
        <p className="font-medium text-fg">{title}</p>
        <p className="mt-1 text-[13px] leading-4.5 text-fg-muted">{body}</p>
        {error.requestId ? (
          <p className="mt-2 text-[12px] text-fg-subtle">
            Référence : <span className="font-mono">{error.requestId}</span>
          </p>
        ) : null}
      </div>
      {error.kind !== "forbidden" && error.kind !== "not_found" ? <RetryButton /> : null}
    </div>
  );
}

export function PermissionState({ role }: { role: string }) {
  return (
    <div className="card flex flex-col items-center gap-3 rounded-xl border border-border px-4 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-xl border border-border bg-primary-tint text-primary">
        <Lock aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <div className="max-w-sm">
        <h1 className="text-[17px] font-semibold text-fg">Accès réservé</h1>
        <p className="mt-1 text-[13px] leading-4.5 text-fg-muted">
          Cette page est réservée au rôle <strong className="font-medium text-fg">{role}</strong>. Connectez-vous avec un
          compte administrateur pour y accéder.
        </p>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-lg bg-hover", className)} />;
}

export function TableSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y divide-border">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-4 px-5 lg:px-6">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

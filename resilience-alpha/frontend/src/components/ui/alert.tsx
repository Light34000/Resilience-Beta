import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type Tone = "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, { cls: string; icon: LucideIcon; iconCls: string }> = {
  info: { cls: "border-primary/30 bg-primary-tint", icon: Info, iconCls: "text-primary" },
  success: { cls: "border-success/30 bg-success-tint", icon: CircleCheck, iconCls: "text-success" },
  warning: { cls: "border-warning/30 bg-warning-tint", icon: TriangleAlert, iconCls: "text-warning" },
  danger: { cls: "border-danger/35 bg-danger-tint", icon: CircleAlert, iconCls: "text-danger" },
};

interface AlertProps {
  tone: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** "alert" pour une erreur qui vient d'arriver, "status" pour une information. */
  role?: "alert" | "status";
}

export function Alert({ tone, title, children, action, className, role }: AlertProps) {
  const { cls, icon: Icon, iconCls } = TONES[tone];
  return (
    <div role={role} className={cn("flex gap-3 rounded-lg border px-4 py-3.5", cls, className)}>
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", iconCls)} strokeWidth={2.25} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{title}</p>
        {children ? <div className="mt-0.5 text-[13px] leading-5 text-fg-muted">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

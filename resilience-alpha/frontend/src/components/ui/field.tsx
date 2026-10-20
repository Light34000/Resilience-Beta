import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

const control =
  "block w-full rounded-lg border border-border-strong bg-surface px-3.5 text-[16px] text-fg " +
  "placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-150 hover:border-fg-subtle " +
  "focus-visible:border-primary focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--primary-tint)] " +
  "aria-invalid:border-danger aria-invalid:focus-visible:shadow-[0_0_0_3px_var(--danger-tint)] disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-12 lg:h-11", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-12 pr-9 lg:h-11", className)} {...props}>
      {children}
    </select>
  );
}

interface FieldProps {
  id: string;
  label: string;
  optional?: boolean;
  helper?: ReactNode;
  error?: string;
  children: (aria: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
  className?: string;
}

/** Libellé visible + aide + erreur annoncée, reliés au contrôle par aria-describedby. */
export function Field({ id, label, optional, helper, error, children, className }: FieldProps) {
  const helperId = helper ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-[14px] font-medium text-fg">
        {label}
        {optional ? <span className="ml-1 font-normal text-fg-subtle">(facultatif)</span> : null}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] leading-4.5 text-danger">
          {error}
        </p>
      ) : null}
      {helper ? (
        <p id={helperId} className="text-[13px] leading-4.5 text-fg-subtle">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

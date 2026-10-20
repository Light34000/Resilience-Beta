import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/** Tableau sémantique ; le défilement horizontal reste à l'intérieur de son conteneur sur mobile.
 *  Le conteneur est focalisable pour pouvoir défiler au clavier. */
export function Table({ className, caption, children, ...props }: ComponentProps<"table"> & { caption: string }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className={cn("w-full border-collapse text-left text-[14px]", className)} {...props}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function THead(props: ComponentProps<"thead">) {
  return <thead {...props} />;
}

export function TH({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "h-10 border-y border-border bg-surface-subtle px-3 text-[12px] font-semibold tracking-[0.06em] whitespace-nowrap text-fg-muted uppercase first:pl-5 last:pr-5 lg:first:pl-6 lg:last:pr-6",
        className,
      )}
      {...props}
    />
  );
}

export function TR({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn("border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-hover", className)}
      {...props}
    />
  );
}

export function TD({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("h-12 px-3 align-middle first:pl-5 last:pr-5 lg:first:pl-6 lg:last:pr-6", className)} {...props} />;
}

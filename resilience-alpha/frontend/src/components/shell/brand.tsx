import { cn } from "@/lib/cn";

/** Logo : le nom de l'application en serif (Source Serif 4), sans pictogramme. */
export function Brand({ className, size = "md", tone = "default" }: { className?: string; size?: "md" | "lg"; tone?: "default" | "inverse" }) {
  return (
    <span
      className={cn(
        "font-serif leading-none font-semibold tracking-[-0.01em] whitespace-nowrap",
        size === "lg" ? "text-[26px]" : "text-[20px]",
        tone === "inverse" ? "text-[#f4f1ea]" : "text-fg",
        className,
      )}
    >
      Resilience Alpha
    </span>
  );
}

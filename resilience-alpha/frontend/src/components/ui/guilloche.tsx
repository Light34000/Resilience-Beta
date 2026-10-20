import { cn } from "@/lib/cn";

/** Guilloché : rosace de courbes entrelacées, comme sur les billets et les chèques. Purement décoratif.
 *  Calculé au rendu serveur (SVG statique, aucun script) ; la couleur suit `currentColor`. */
export function Guilloche({
  className,
  rings = 22,
  petals = 14,
  size = 520,
}: {
  className?: string;
  rings?: number;
  petals?: number;
  size?: number;
}) {
  const c = size / 2;
  const paths: string[] = [];
  for (let i = 0; i < rings; i++) {
    const base = size * 0.12 + i * ((size * 0.36) / rings);
    const amp = size * (0.018 + 0.012 * Math.sin(i * 0.7));
    const phase = i * 0.42;
    let d = "";
    for (let s = 0; s <= 720; s++) {
      const t = (s / 720) * Math.PI * 2;
      const r = base + amp * Math.sin(petals * t + phase) + amp * 0.5 * Math.sin((petals / 2) * t - phase);
      d += `${s ? "L" : "M"}${(c + r * Math.cos(t)).toFixed(1)} ${(c + r * Math.sin(t)).toFixed(1)}`;
    }
    paths.push(`${d}Z`);
  }
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${size} ${size}`} className={cn("pointer-events-none", className)} fill="none">
      {paths.map((d, i) => (
        <path key={i} d={d} stroke="currentColor" strokeWidth={0.6} strokeOpacity={0.35 + (i % 4) * 0.12} />
      ))}
    </svg>
  );
}

/** Lignes ondulées fines (fond de chèque), pour un bandeau. */
export function GuillocheWaves({ className, lines = 14 }: { className?: string; lines?: number }) {
  const w = 800;
  const h = 200;
  const paths: string[] = [];
  for (let i = 0; i < lines; i++) {
    const y0 = (h / (lines + 1)) * (i + 1);
    let d = "";
    for (let x = 0; x <= w; x += 4) {
      const y = y0 + 6 * Math.sin(x / 38 + i * 0.6) + 3 * Math.sin(x / 13 - i);
      d += `${x ? "L" : "M"}${x} ${y.toFixed(1)}`;
    }
    paths.push(d);
  }
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("pointer-events-none", className)} fill="none">
      {paths.map((d, i) => (
        <path key={i} d={d} stroke="currentColor" strokeWidth={0.6} strokeOpacity={0.5} />
      ))}
    </svg>
  );
}

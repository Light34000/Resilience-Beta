"use client";

import { cn } from "@/lib/cn";
import { serviceLabel } from "@/lib/messages";
import { SERVICES, type HealthSnapshot, type ServiceState } from "@/lib/types";

// Repère fixe (viewBox) : la carte s'adapte en largeur, elle est masquée sous 768 px (le tableau suffit).
const W = 960;
const H = 380;
const CLIENT = { x: 100, y: H / 2 };
const GATEWAY = { x: 380, y: H / 2 };
const SERVICE_X = 760;
const rowY = (i: number) => 50 + i * ((H - 100) / (SERVICES.length - 1));

type NodeState = ServiceState | "pending";

const DOT: Record<NodeState, string> = {
  up: "fill-success",
  down: "fill-danger",
  unknown: "fill-fg-subtle",
  pending: "fill-border-strong",
};
const TEXT: Record<NodeState, string> = { up: "Opérationnel", down: "Indisponible", unknown: "Inconnu", pending: "…" };

function Node({ x, y, label, sub, state, w = 176 }: { x: number; y: number; label: string; sub: string; state: NodeState; w?: number }) {
  const h = 54;
  return (
    <g transform={`translate(${x - w / 2} ${y - h / 2})`}>
      <rect width={w} height={h} rx={10} className={cn("fill-surface", state === "down" ? "stroke-danger" : "stroke-border")} strokeWidth={state === "down" ? 1.5 : 1} />
      <circle cx={22} cy={h / 2} r={5} className={DOT[state]} />
      <text x={38} y={23} className="fill-fg" fontSize={14} fontWeight={600}>
        {label}
      </text>
      <text x={38} y={40} className={state === "down" ? "fill-danger" : "fill-fg-muted"} fontSize={12}>
        {sub}
      </text>
    </g>
  );
}

function Link({ from, to, state }: { from: { x: number; y: number }; to: { x: number; y: number }; state: NodeState }) {
  const mx = (from.x + to.x) / 2;
  const d = `M ${from.x} ${from.y} C ${mx} ${from.y}, ${mx} ${to.y}, ${to.x} ${to.y}`;
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={1.5}
      strokeDasharray={state === "up" ? "4 4" : state === "down" ? "2 6" : undefined}
      // Tirets qui défilent = trafic qui circule ; immobiles quand le service ne répond plus.
      className={cn(
        state === "up" && "animate-dash stroke-success",
        state === "down" && "stroke-danger",
        (state === "unknown" || state === "pending") && "stroke-border-strong",
      )}
    />
  );
}

export function Topology({ snapshot }: { snapshot: HealthSnapshot | null }) {
  const gw: NodeState = !snapshot ? "pending" : snapshot.gateway === "up" ? "up" : "down";
  const up = snapshot?.services.filter((s) => s.state === "up").length ?? 0;
  return (
    <div className="relative hidden overflow-hidden border-b border-border bg-surface-subtle bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:18px_18px] md:block">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="relative block h-auto w-full"
        role="img"
        aria-label={
          snapshot
            ? `Topologie : passerelle ${gw === "up" ? "opérationnelle" : "indisponible"}, ${up} services opérationnels sur ${SERVICES.length}.`
            : "Topologie : première vérification en cours."
        }
      >
        <Link from={{ x: CLIENT.x + 80, y: CLIENT.y }} to={{ x: GATEWAY.x - 88, y: GATEWAY.y }} state={gw} />
        {SERVICES.map((name, i) => {
          const s = snapshot?.services.find((x) => x.service === name);
          return <Link key={name} from={{ x: GATEWAY.x + 88, y: GATEWAY.y }} to={{ x: SERVICE_X - 88, y: rowY(i) }} state={s?.state ?? "pending"} />;
        })}
        <Node x={CLIENT.x} y={CLIENT.y} label="Clients" sub="navigateur, sonde" state={gw === "pending" ? "pending" : "up"} w={160} />
        <Node x={GATEWAY.x} y={GATEWAY.y} label="Passerelle" sub={TEXT[gw]} state={gw} />
        {SERVICES.map((name, i) => {
          const s = snapshot?.services.find((x) => x.service === name);
          const state = s?.state ?? "pending";
          const sub = state === "up" && s?.latencyMs != null ? `${TEXT.up} · ${s.latencyMs} ms` : TEXT[state];
          return <Node key={name} x={SERVICE_X} y={rowY(i)} label={serviceLabel(name)} sub={sub} state={state} />;
        })}
      </svg>
    </div>
  );
}

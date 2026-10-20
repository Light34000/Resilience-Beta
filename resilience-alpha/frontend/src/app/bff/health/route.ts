import { NextResponse } from "next/server";

import { request } from "@/lib/api";
import { getSession } from "@/lib/session";
import type { HealthSnapshot, ServiceCheck, ServiceName } from "@/lib/types";

// Une lecture authentifiée peu coûteuse par service, via la passerelle (le seul chemin ouvert vers la plateforme).
const PROBES: Record<ServiceName, string> = {
  auth: "/api/auth/me",
  accounts: "/api/accounts/me",
  payments: "/api/payments?limit=1",
  notifications: "/api/notifications/me?limit=1",
  audit: "/api/audit/events?limit=1",
};

const TIMEOUT_MS = 3000;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ detail: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ detail: "forbidden" }, { status: 403 });

  const entries = Object.entries(PROBES) as [ServiceName, string][];
  const results = await Promise.all(
    entries.map(([, path]) => request<unknown>(path, { token: session.token, timeoutMs: TIMEOUT_MS })),
  );

  const gatewayDown = results.every((r) => !r.ok && r.kind === "unreachable");
  const services: ServiceCheck[] = entries.map(([service], i) => {
    const r = results[i];
    if (!r.ok && r.kind === "unreachable") {
      return { service, state: "unknown", httpStatus: null, latencyMs: null };
    }
    // Toute réponse < 500 prouve que le service a traité la requête (même un 401/403).
    const up = r.ok || (r.status > 0 && r.status < 500);
    return { service, state: up ? "up" : "down", httpStatus: r.status || null, latencyMs: r.durationMs };
  });

  const snapshot: HealthSnapshot = {
    checkedAt: new Date().toISOString(),
    gateway: gatewayDown ? "down" : "up",
    services,
  };
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}

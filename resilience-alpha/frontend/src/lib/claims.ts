// Décodage des claims JWT sans vérification de signature (utilisable dans proxy.ts et côté serveur).
// Sert uniquement à l'affichage et au routage optimiste : la passerelle reste l'autorité.

import type { Role } from "./types";

export const SESSION_COOKIE = "ra_session";

export interface SessionClaims {
  sub: string;
  username: string;
  role: Role;
  exp: number;
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return atob(padded);
}

export function decodeClaims(token: string): SessionClaims | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const raw: unknown = JSON.parse(base64UrlDecode(part));
    if (typeof raw !== "object" || raw === null) return null;
    const c = raw as Record<string, unknown>;
    if (typeof c.sub !== "string" || typeof c.exp !== "number") return null;
    const role: Role = c.role === "admin" ? "admin" : "customer";
    return { sub: c.sub, exp: c.exp, role, username: typeof c.username === "string" ? c.username : c.sub };
  } catch {
    return null;
  }
}

/** N'accepte que des chemins internes (pas de redirection ouverte vers un autre site). */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
}

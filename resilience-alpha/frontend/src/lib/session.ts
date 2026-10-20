import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { decodeClaims, SESSION_COOKIE, type SessionClaims } from "./claims";

export interface Session extends SessionClaims {
  token: string;
}

/** Session courante (jeton dans un cookie httpOnly). Les claims ne sont lus que pour l'affichage et le routage :
 *  la passerelle et les services vérifient la signature à chaque appel. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = decodeClaims(token);
  if (!claims || claims.exp * 1000 <= Date.now()) return null;
  return { ...claims, token };
});

export async function setSessionCookie(token: string, maxAgeSeconds: number): Promise<void> {
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Chemin de la requête courante, posé par proxy.ts (utile pour revenir à la page après reconnexion). */
export async function currentPath(): Promise<string> {
  return (await headers()).get("x-pathname") ?? "/";
}

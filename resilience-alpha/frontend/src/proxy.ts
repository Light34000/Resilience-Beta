import { NextResponse, type NextRequest } from "next/server";

import { decodeClaims, SESSION_COOKIE } from "@/lib/claims";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

/** Vérification optimiste de session (expiration lue dans le jeton) et chemin courant pour les Server Components.
 *  L'autorisation réelle reste faite par la passerelle à chaque appel. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? decodeClaims(token) : null;
  const valid = claims !== null && claims.exp * 1000 > Date.now() + 5_000;
  const expiredNotice = request.nextUrl.searchParams.get("expired") === "1";

  if (PUBLIC_PATHS.has(pathname)) {
    if (valid && !expiredNotice) return NextResponse.redirect(new URL("/", request.url));
    const res = NextResponse.next();
    if (token && (!valid || expiredNotice)) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (!valid) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    if (token) login.searchParams.set("expired", "1");
    const res = NextResponse.redirect(login);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const headers = new Headers(request.headers);
  headers.set("x-pathname", `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages uniquement : ni les fichiers statiques, ni le BFF (qui répond lui-même 401 en JSON).
  matcher: ["/((?!_next/|bff/|favicon.ico|icon|robots.txt).*)"],
};

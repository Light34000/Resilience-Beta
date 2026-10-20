"use server";

import { redirect } from "next/navigation";

import { request, type ApiError } from "@/lib/api";
import { safeNext } from "@/lib/claims";
import { clearSessionCookie, setSessionCookie } from "@/lib/session";
import type { Me, TokenOut } from "@/lib/types";

export interface AuthFormState {
  message?: string;
  fieldErrors?: Partial<Record<"username" | "password", string>>;
  values?: { username: string };
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function serviceDown(error: ApiError): string | null {
  if (error.kind === "unreachable") return "La plateforme est injoignable. Réessayez dans quelques secondes.";
  if (error.kind === "unavailable" || error.kind === "timeout")
    return "Le service d'authentification est indisponible ou en reprise. Réessayez dans quelques secondes.";
  if (error.kind === "rate_limited") {
    const wait = error.retryAfter ?? 60;
    return `Trop de tentatives de connexion. Réessayez dans ${wait} secondes.`;
  }
  return null;
}

async function signIn(username: string, password: string): Promise<{ ok: true } | { ok: false; error: ApiError }> {
  const res = await request<TokenOut>("/api/auth/login", { method: "POST", body: { username, password } });
  if (!res.ok) return { ok: false, error: res };
  await setSessionCookie(res.data.access_token, res.data.expires_in);
  return { ok: true };
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const values = { username };

  const fieldErrors: AuthFormState["fieldErrors"] = {};
  if (!username) fieldErrors.username = "Saisissez votre identifiant.";
  if (!password) fieldErrors.password = "Saisissez votre mot de passe.";
  if (fieldErrors.username || fieldErrors.password) return { fieldErrors, values };

  const result = await signIn(username, password);
  if (!result.ok) {
    const down = serviceDown(result.error);
    if (down) return { message: down, values };
    if (result.error.kind === "unauthorized") return { message: "Identifiant ou mot de passe incorrect.", values };
    return { message: result.error.message, values };
  }
  redirect(next);
}

export async function register(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const values = { username };

  const fieldErrors: AuthFormState["fieldErrors"] = {};
  if (!USERNAME_RE.test(username))
    fieldErrors.username = "3 à 32 caractères : lettres, chiffres, point, tiret ou tiret bas.";
  if (password.length < 8 || password.length > 72) fieldErrors.password = "Entre 8 et 72 caractères.";
  if (fieldErrors.username || fieldErrors.password) return { fieldErrors, values };

  const created = await request<Me>("/api/auth/register", { method: "POST", body: { username, password } });
  if (!created.ok) {
    const down = serviceDown(created);
    if (down) return { message: down, values };
    if (created.kind === "conflict") return { fieldErrors: { username: "Cet identifiant est déjà pris." }, values };
    if (created.kind === "validation") {
      return {
        fieldErrors: { username: created.fieldErrors.username, password: created.fieldErrors.password },
        values,
      };
    }
    return { message: created.message, values };
  }

  const result = await signIn(username, password);
  if (!result.ok) redirect("/login?registered=1");
  redirect("/");
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

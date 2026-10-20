import "server-only";

import { redirect } from "next/navigation";

import { validationMessage } from "./messages";
import { currentPath, getSession } from "./session";

// Toutes les requêtes vers la plateforme passent par ici : le navigateur ne parle jamais à la passerelle.
const GATEWAY_URL = (process.env.GATEWAY_URL ?? "http://localhost:8080").replace(/\/$/, "");
const DEFAULT_TIMEOUT_MS = 8000;

export type ApiErrorKind =
  | "unreachable" // passerelle injoignable
  | "timeout"
  | "unavailable" // 502 / 503 / 504 : service en panne ou en reprise
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "error";

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
  requestId: string | null;
  durationMs: number;
}

export interface ApiError {
  ok: false;
  status: number;
  kind: ApiErrorKind;
  message: string;
  /** Erreurs de validation 422, par nom de champ (dernier élément de `loc`). */
  fieldErrors: Record<string, string>;
  detail: unknown;
  requestId: string | null;
  retryAfter: number | null;
  durationMs: number;
}

export type ApiResult<T> = ApiSuccess<T> | ApiError;

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function kindFor(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 504) return "unavailable";
  return "error";
}

function parseDetail(detail: unknown): { message: string | null; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  if (typeof detail === "string") return { message: detail, fieldErrors };
  if (Array.isArray(detail)) {
    for (const item of detail) {
      if (typeof item !== "object" || item === null) continue;
      const { loc, type, msg, ctx } = item as { loc?: unknown; type?: unknown; msg?: unknown; ctx?: unknown };
      const field = Array.isArray(loc) ? String(loc[loc.length - 1]) : "_";
      if (!fieldErrors[field]) {
        fieldErrors[field] = validationMessage(String(type ?? ""), String(msg ?? ""), ctx);
      }
    }
    return { message: null, fieldErrors };
  }
  return { message: null, fieldErrors };
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const started = performance.now();
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      status: 0,
      kind: timeout ? "timeout" : "unreachable",
      message: timeout ? "Le service n'a pas répondu à temps." : "La plateforme est injoignable.",
      fieldErrors: {},
      detail: null,
      requestId: null,
      retryAfter: null,
      durationMs: Math.round(performance.now() - started),
    };
  }

  const durationMs = Math.round(performance.now() - started);
  const requestId = res.headers.get("x-request-id");
  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  let payload: unknown = null;
  if (isJson) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  }

  if (res.ok) {
    return { ok: true, status: res.status, data: payload as T, requestId, durationMs };
  }

  const detail = typeof payload === "object" && payload !== null ? (payload as { detail?: unknown }).detail : null;
  const parsed = parseDetail(detail);
  const retryAfterHeader = Number(res.headers.get("retry-after"));
  return {
    ok: false,
    status: res.status,
    kind: kindFor(res.status),
    message: parsed.message ?? `Erreur HTTP ${res.status}`,
    fieldErrors: parsed.fieldErrors,
    detail,
    requestId,
    retryAfter: Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : null,
    durationMs,
  };
}

/** Appel authentifié depuis un Server Component ou une Server Action.
 *  Sans session ou sur un 401, renvoie vers la connexion (puis vers la page courante). */
export async function authed<T>(path: string, opts: Omit<RequestOptions, "token"> = {}): Promise<ApiResult<T>> {
  const session = await getSession();
  const next = encodeURIComponent(await currentPath());
  if (!session) redirect(`/login?next=${next}`);
  const result = await request<T>(path, { ...opts, token: session.token });
  if (!result.ok && result.kind === "unauthorized") redirect(`/login?expired=1&next=${next}`);
  return result;
}

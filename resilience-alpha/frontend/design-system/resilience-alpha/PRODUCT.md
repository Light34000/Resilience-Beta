# Product map — Resilience Alpha front

Companion to `MASTER.md`. It records what the backend can actually do and how each capability maps to a
screen. Anything not listed here has no backend support and must not be faked.

## 1. Architecture (backend-for-frontend)

```
Browser ──► Next.js server (this app, :3001) ──► Nginx gateway :8080 ──► services
            · holds the JWT in an httpOnly cookie (ra_session)
            · Server Components fetch with the token
            · Server Actions perform writes (login, register, open account, pay)
            · /bff/health route handler: admin-only service checks for Supervision
```

Why: the gateway has no CORS, and the JWT must not be readable by page JavaScript (no `localStorage`). The
browser only talks to the Next.js origin.

Known consequence: every request reaches the gateway from the Next.js server's IP. The gateway's login rate
limit (10/min per IP) and auth's lockout counter (5 failures/min per IP) are therefore **shared by all users of
this front**. Acceptable in the lab. In production, the gateway would need to trust a forwarded client IP from
the front only.

## 2. Capability → screen mapping

| Backend capability (gateway) | Screen | Role |
|---|---|---|
| `POST /api/auth/register` | `/register` | public |
| `POST /api/auth/login` (JWT 15 min, no refresh) | `/login` (session expiry → back here with a notice) | public |
| `GET /api/auth/me` | sidebar identity block | all |
| `GET /api/accounts/me`, `POST /api/accounts` | `/accounts`, `/accounts/new` | customer, admin |
| `GET /api/accounts/{id}` | `/accounts/[id]` | owner, admin |
| `POST /api/payments` (Idempotency-Key) | `/payments/new` (enter → review → confirm) | customer, admin |
| `GET /api/payments?limit=` | `/payments` (filters status/account in query string), overview | all |
| `GET /api/payments/{id}` | `/payments/[id]` (auto-refresh while `pending`) | owner, admin |
| `GET /api/notifications/me?limit=` | `/notifications`, overview | all |
| `GET /api/audit/events?service=&action=&limit=` | `/admin/audit`; incidents in `/admin/system` | admin |
| `GET /api/audit/verify` | `/admin/audit` (on demand) | admin |
| Service reachability through the gateway (see 4) | `/admin/system` | admin |

Not supported by the backend, therefore not in the UI: refresh tokens, password change, profile edit, account
names, account search/directory, incoming payments from other users, notification read/unread state, real-time
push, canary history, remediation incident detail (`/internal/*` is not routed by the gateway).

## 3. Information architecture

```
/login                      Connexion
/register                   Création de compte
/                           Vue d'ensemble     soldes par devise · paiements récents · notifications récentes
/accounts                   Comptes            tableau des comptes · « Ouvrir un compte »
/accounts/new               Ouvrir un compte   devise · solde initial (démo)
/accounts/[id]              Détail du compte   solde · identifiant · paiements liés · « Payer depuis ce compte »
/payments                   Paiements          tableau filtrable (statut, compte)
/payments/new               Nouveau paiement   saisie → vérification → confirmation
/payments/[id]              Détail paiement    statut, chronologie, raison d'échec, clé d'idempotence
/notifications              Notifications      liste chronologique
/admin/system               Supervision        état des services (direct), incidents (audit), intégrité audit
/admin/audit                Journal d'audit    filtres service/action/limite · vérification de la chaîne
```

Sidebar groups: main (4 items) · Administration (2 items, admin only) · identity + theme + logout at the bottom.

## 4. Supervision data, honestly sourced

1. **Service checks** (live): every 5 s while the page is open and not paused, the browser calls `/bff/health`.
   The Next.js server calls one cheap authenticated read per service through the gateway:

   | Service | Probe | "Up" means |
   |---|---|---|
   | auth | `GET /api/auth/me` | any non-5xx response |
   | accounts | `GET /api/accounts/me` | idem |
   | payments | `GET /api/payments?limit=1` | idem |
   | notifications | `GET /api/notifications/me?limit=1` | idem |
   | audit | `GET /api/audit/events?limit=1` | idem |

   502/503/504 or timeout (3 s) → down. Gateway unreachable → every service "unknown" and the gateway is down.
   The UI says these checks come from the front, not from Prometheus or the canary.
2. **Incidents** (durable): audit events of service `remediation` grouped by `details.incident_id`
   (`incident_opened` → `incident_resolved|failed|escalated`, plus `incident_suppressed`). Shows service, type,
   source, opened time, outcome, duration.
3. **Audit chain**: `GET /api/audit/verify` on demand (it can scan up to 100 000 rows).

Grafana remains the jury's main "before / during / after" dashboard; this page is the operator's view inside the product.

## 5. Primary workflows

1. **Sign up and sign in.** Register → automatic sign-in → overview. Wrong password: inline error. 429: wait message with seconds.
2. **Open an account.** Accounts → "Ouvrir un compte" → currency + demo initial balance → account detail.
3. **Send a payment.** New payment → pick source account, destination (own account or account ID), amount →
   review screen (exact amounts, both accounts) → confirm. Outcomes:
   - `completed` → payment detail with success banner.
   - `failed` (201) → stays on the form, explains the reason in plain French, keeps inputs, new idempotency key.
   - `pending` (503) → payment detail in "en cours" state, refreshes every 5 s until settled.
   - 502/504/network → error banner, **same idempotency key** kept so "Réessayer" cannot double-charge.
   - 422 → errors attached to the right field.
4. **Track a payment.** Payment detail shows status, created/updated times, reason, the idempotency key used.
5. **Review history.** Payments table filtered by status and account; deep-linkable.
6. **Read notifications.** Notifications list; overview shows the latest five.
7. **Session expiry.** Any 401 → `/login?expired=1` with "Session expirée, reconnectez-vous" and return to the previous page after sign-in.
8. **Monitor recovery (admin).** Supervision: live service strip goes red during an outage, incidents list
   shows the remediation outcome and duration once audit records it.
9. **Audit (admin).** Filter events, expand details, verify the hash chain.

## 6. States every screen must handle

| State | Treatment |
|---|---|
| Loading | Skeletons sized like the content (Suspense per section, so one slow service doesn't block the page) |
| Empty | `EmptyState` with the next action ("Ouvrir un compte", "Faire un paiement") |
| Service down (502/503/504/timeout) | `ErrorState` naming the service, retry button, request ID |
| Permission (403 / non-admin) | Permission state explaining the role needed |
| Session expired (401) | Redirect to login with notice |
| Pending operation | Warning badge + live refresh + `aria-live` |
| Offline (browser) | Top banner "Hors ligne" while `navigator.onLine` is false |
| Stale (supervision) | "Dernière vérification il y a N s"; after a failed refresh the last data is kept and marked stale |

## 7. Implementation and verification checklist

- [ ] Strict TypeScript, no `any`. `npm run build` and `npm run lint` pass.
- [ ] Server Components by default; `"use client"` only for forms, nav active state, theme toggle, polling, copy.
- [ ] All gateway calls go through `src/lib/api.ts` (timeouts, typed results, 401 handling).
- [ ] Every page in section 3 exists, is reachable from navigation, and handles section 6 states.
- [ ] Real stack test: smoke flow through the UI (register → account → payment → notification → admin audit).
- [ ] Outage test: `docker stop rsl-payments` → payment form error / pending path, supervision shows payments down, recovery shows up.
- [ ] Browser screenshots at 375 / 768 / 1024 / 1440, light and dark.
- [ ] Keyboard pass and automated a11y checks (contrast, labels, landmarks).
- [ ] MASTER.md checklist (section 11) passes.

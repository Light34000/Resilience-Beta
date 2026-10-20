# Design System Master File — Resilience Alpha · « Banque privée » (v3)

> **LOGIC:** When building a specific page, first check `design-system/resilience-alpha/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. If not, follow the rules below.
>
> Implementation source of truth for tokens: `src/app/globals.css`. Keep this file and the CSS in sync.

**Revised:** 2026-10-19 (v3). History: v1 restrained SaaS (judged too plain) → v2 « Aurora Ops » with violet
gradients and WebGL shaders (judged too colorful) → v3: **a professional banking app** — calm, accessible,
readable, with a few distinctive details. Decided by the product owner.

---

## 1. Direction

Feels like a private bank's online space, not a startup dashboard: ivory paper, ink navy, one restrained accent,
serif for identity and key figures, sans for everything you read or operate. Charm comes from craft details that
belong to banking — a **guilloché** rosette (the engraved line pattern of banknotes and cheques) and fine gold
rules — never from color or motion.

## 2. Color tokens (light default, dark via `data-theme="dark"`)

| Token | Light | Dark | Use | Contrast on surface (L / D) |
|---|---|---|---|---|
| `--bg` | `#f6f5f1` ivory | `#0b111c` | Page | – |
| `--surface` / `--surface-subtle` / `--hover` | `#ffffff` / `#f1efe9` / `#f3f1ec` | `#111a29` / `#172235` / `#172235` | Cards / table headers / hover | – |
| `--border` / `--border-strong` | `#e3e0d8` / `#8a8578` | `#223049` / `#5f6c86` | Dividers / input borders | – / 3.7 / 3.3 |
| `--fg` / `--fg-muted` / `--fg-subtle` | `#0e1a2b` / `#4a5263` / `#5f6878` | `#eceff4` / `#a9b3c4` / `#8e99ad` | Text | 17.5 / 7.8 / 5.6 · 15.1 / 8.3 / 6.1 |
| `--primary` | `#1d4a80` | `#93b4e2` | Links, active nav, focus | 9.0 / 8.2 |
| `--primary-solid` + `--on-primary` | `#1b2f4e` + white | `#c9d8ef` + `#0b111c` | Primary buttons, avatar | 13.4 / 13.1 |
| `--gold` | `#8a6a1f` | `#d4b574` | Decorative rules and patterns only (never body text) | 5.1 / 8.9 |
| `--panel` | `#13243f` | `#0e1828` | Navy brand panel (sign-in) | text `#eceff4` 13.5 |
| Status `--success` / `--warning` / `--danger` | `#1d6b45` / `#8a5300` / `#a61b29` | `#5cc58a` / `#e8b04a` / `#f08a8f` | Always icon + label | ≥ 5.7 on their tints |

No gradients, no glow, no translucent glass, no neon. Shadows: one card shadow (1–2 px), one overlay shadow.

## 3. Typography

| Role | Font | Size |
|---|---|---|
| Logo (wordmark) | **Source Serif 4**, 600 | 20 px (app), 26 px (sign-in) — the name only, no icon |
| Page title, auth titles, hero balance | Source Serif 4, 600 | 30–34 px titles, 44–52 px balance (tabular figures) |
| UI, body, tables | **Inter** | 15 px body (22 px line height), 14 px labels, 12 px uppercase table headers |
| IDs, hashes, keys | Geist Mono | 13 px |

Labels are 14 px in full ink (not muted) for readability. Inputs 16 px (no zoom on iOS).

## 4. Layout & ergonomics (HIG)

- Solid white sidebar (256 px) with a border; active item = navy tint + 3 px navy bar; drawer below 1024 px.
- Content max 1200 px; overview grid: balance 4/6 + activity 2/6, payments 4/6 + notifications 2/6.
- Touch targets ≥ 44 px below 1024 px; one primary (navy) action per view; clear back links on detail pages.
- Radii: 8 px controls, 12 px cards. Spacing on a 4 px grid.
- Motion: 350 ms fade-rise on page entry, flowing dashes on live topology links, live-dot pulse — all off with
  `prefers-reduced-motion`.

## 5. Signature details

| Detail | Where | Rule |
|---|---|---|
| Guilloché rosette (`components/ui/guilloche.tsx`, SVG computed server-side) | Sign-in navy panel (gold, masked away from text), balance card corner (navy, 16 % opacity, ≥ 768 px) | Decorative, `aria-hidden`, never behind body text at full strength |
| Gold rule + uppercase eyebrow | Page headers, sign-in | Max one per view |
| Serif figures | Balance, activity total | Only for the one headline number of a card |

## 6. Accessibility

WCAG 2.2 AA in both themes (table above), visible 2 px focus ring + 3 px tint ring on inputs, skip link,
labels above fields, announced errors, status never by color alone, no horizontal page scroll at 375 px,
axe clean on every page.

## 7. Anti-patterns

Gradients and gradient text · glow/neon · glass blur · WebGL backgrounds · animated counters on money ·
more than one accent color · gold for text · decorative icons in the logo · fake data · color-only status.

## 8. Pre-delivery checklist

- [ ] Tokens only; lint + typecheck clean
- [ ] Loading / empty / error (per service) / permission states
- [ ] 375 / 768 / 1024 / 1440 × light and dark: no page overflow, screenshots reviewed
- [ ] axe clean in both themes; keyboard pass (skip link, focus, drawer Esc, forms)

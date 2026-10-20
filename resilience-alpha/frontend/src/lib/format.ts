// Formatage partagé serveur/client. Fuseau explicite : le serveur peut tourner dans un autre fuseau que le jury.

export const TIME_ZONE = "Europe/Paris";

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: TIME_ZONE,
});

const dateOnly = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: TIME_ZONE });

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateOnly.format(d);
}

/** Formate un montant reçu en chaîne décimale, sans passer par un float pour l'arithmétique. */
export function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Somme exacte de montants décimaux à 2 chiffres (en centimes entiers). */
export function sumAmounts(amounts: string[]): string {
  let cents = BigInt(0);
  for (const a of amounts) {
    const [whole, frac = ""] = a.split(".");
    const sign = whole.startsWith("-") ? BigInt(-1) : BigInt(1);
    const w = BigInt(whole.replace("-", "") || "0");
    const f = BigInt((frac + "00").slice(0, 2));
    cents += sign * (w * BigInt(100) + f);
  }
  const neg = cents < BigInt(0);
  const abs = neg ? -cents : cents;
  const str = `${abs / BigInt(100)}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
  return neg ? `-${str}` : str;
}

/** Identifiant raccourci pour l'affichage : début…fin. La valeur complète reste disponible (title, copie). */
export function shortId(id: string, head = 8, tail = 4): string {
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Nom lisible d'un compte (la plateforme n'a pas de nom de compte) : devise + fin d'identifiant. */
export function accountLabel(account: { id: string; currency: string }): string {
  return `Compte ${account.currency} ··${account.id.slice(-4)}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    const digits = seconds < 10 ? 1 : 0;
    return `${seconds.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} s`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}

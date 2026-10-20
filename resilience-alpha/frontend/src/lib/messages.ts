// Libellés destinés aux utilisateurs (français), à partir des codes renvoyés par la plateforme.

const FAILURE_REASONS: Record<string, string> = {
  insufficient_funds: "Solde insuffisant sur le compte source.",
  account_not_found: "Compte destinataire introuvable. Vérifiez l'identifiant.",
  not_account_owner: "Le compte source ne vous appartient pas.",
  currency_mismatch: "Les deux comptes n'ont pas la même devise.",
  same_account: "Le compte source et le compte destinataire sont identiques.",
};

export function failureReason(reason: string | null | undefined): string {
  if (!reason) return "Raison non précisée.";
  return FAILURE_REASONS[reason] ?? `Refusé par la plateforme (${reason}).`;
}

export function validationMessage(type: string, msg: string, ctx: unknown): string {
  const c = (typeof ctx === "object" && ctx !== null ? ctx : {}) as Record<string, unknown>;
  switch (type) {
    case "missing":
      return "Champ obligatoire.";
    case "uuid_parsing":
    case "uuid_type":
      return "Identifiant de compte invalide.";
    case "decimal_max_places":
      return "Deux décimales au maximum.";
    case "decimal_parsing":
      return "Montant invalide.";
    case "greater_than":
      return "Le montant doit être supérieur à 0.";
    case "greater_than_equal":
      return `La valeur doit être supérieure ou égale à ${String(c.ge ?? 0)}.`;
    case "less_than_equal":
      return `La valeur doit être inférieure ou égale à ${String(c.le ?? "")}.`;
    case "decimal_max_digits":
      return "Montant trop grand.";
    case "string_too_short":
      return `Au moins ${String(c.min_length ?? "")} caractères.`;
    case "string_too_long":
      return `Au plus ${String(c.max_length ?? "")} caractères.`;
    case "string_pattern_mismatch":
      return "Format non accepté.";
    default:
      return msg || "Valeur invalide.";
  }
}

export const SERVICE_LABELS: Record<string, string> = {
  auth: "Authentification",
  accounts: "Comptes",
  payments: "Paiements",
  notifications: "Notifications",
  audit: "Audit",
  remediation: "Remédiation",
  canary: "Sonde",
  detector: "Détecteur",
  gateway: "Passerelle",
};

export function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] ?? service;
}

export const AUDIT_ACTIONS = [
  "user_registered",
  "login_success",
  "login_failed",
  "login_blocked",
  "account_opened",
  "payment_completed",
  "payment_failed",
  "payment_rejected",
  "incident_opened",
  "incident_resolved",
  "incident_failed",
  "incident_escalated",
  "incident_suppressed",
  "traffic_blocked",
] as const;

export const AUDIT_SERVICES = ["auth", "accounts", "payments", "remediation", "detector"] as const;

export const NOTIFICATION_KINDS: Record<string, string> = {
  payment_completed: "Paiement effectué",
  payment_failed: "Paiement refusé",
};

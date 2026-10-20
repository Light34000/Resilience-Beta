// Formes des réponses de la passerelle (voir docs/api/*.openapi.json du dépôt backend).
// Les montants arrivent en chaînes décimales ("74.50") : ne jamais les convertir en float pour calculer.

export type Role = "customer" | "admin";

export interface Me {
  id: string;
  username: string;
  role: Role;
}

export interface Account {
  id: string;
  owner_id: string;
  currency: string;
  balance: string;
  created_at: string;
}

export type PaymentStatus = "pending" | "completed" | "failed";

export interface Payment {
  id: string;
  from_account: string;
  to_account: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  kind: string;
  message: string;
  data: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  ts: string;
  service: string;
  action: string;
  actor: string | null;
  outcome: string;
  details: Record<string, unknown>;
  hash: string;
}

export interface AuditVerify {
  valid: boolean;
  checked: number;
  first_invalid_id: number | null;
}

export interface TokenOut {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export const SERVICES = ["auth", "accounts", "payments", "notifications", "audit"] as const;
export type ServiceName = (typeof SERVICES)[number];

export type ServiceState = "up" | "down" | "unknown";

export interface ServiceCheck {
  service: ServiceName;
  state: ServiceState;
  httpStatus: number | null;
  latencyMs: number | null;
}

export interface HealthSnapshot {
  checkedAt: string;
  gateway: "up" | "down";
  services: ServiceCheck[];
}

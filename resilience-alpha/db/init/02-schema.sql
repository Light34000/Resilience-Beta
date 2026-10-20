-- Tables et droits. Les services n'exécutent AUCUN DDL : ils n'ont que les droits listés ici.

-- ───────────── auth ─────────────
CREATE TABLE auth.users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role          text NOT NULL CHECK (role IN ('customer', 'admin')),
    created_at    timestamptz NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA auth TO svc_auth;
GRANT SELECT, INSERT ON auth.users TO svc_auth;

-- ───────────── accounts (ledger) ─────────────
CREATE TABLE accounts.accounts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   uuid NOT NULL,
    currency   char(3) NOT NULL DEFAULT 'EUR',
    balance    numeric(18,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),  -- pas de découvert, garanti par la base
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON accounts.accounts (owner_id);

CREATE TABLE accounts.ledger_entries (
    id         bigserial PRIMARY KEY,
    tx_id      uuid NOT NULL,
    account_id uuid NOT NULL REFERENCES accounts.accounts (id),
    direction  text NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount     numeric(18,2) NOT NULL CHECK (amount > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tx_id, account_id, direction)   -- idempotence des transferts, y compris sous concurrence
);
CREATE INDEX ON accounts.ledger_entries (tx_id);
CREATE INDEX ON accounts.ledger_entries (account_id);

GRANT USAGE ON SCHEMA accounts TO svc_accounts;
GRANT SELECT, INSERT, UPDATE ON accounts.accounts TO svc_accounts;
GRANT SELECT, INSERT ON accounts.ledger_entries TO svc_accounts;     -- écritures immuables : ni UPDATE ni DELETE
GRANT USAGE ON ALL SEQUENCES IN SCHEMA accounts TO svc_accounts;

-- ───────────── payments ─────────────
CREATE TABLE payments.payments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key text NOT NULL,
    created_by      uuid NOT NULL,
    from_account    uuid NOT NULL,
    to_account      uuid NOT NULL,
    amount          numeric(18,2) NOT NULL CHECK (amount > 0),
    currency        char(3) NOT NULL DEFAULT 'EUR',
    status          text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    failure_reason  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (created_by, idempotency_key)
);
CREATE INDEX ON payments.payments (status, created_at);
CREATE INDEX ON payments.payments (created_by, created_at DESC);

GRANT USAGE ON SCHEMA payments TO svc_payments;
GRANT SELECT, INSERT, UPDATE ON payments.payments TO svc_payments;

-- ───────────── notifications ─────────────
CREATE TABLE notifications.notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL,
    kind       text NOT NULL,
    message    text NOT NULL,
    data       jsonb NOT NULL DEFAULT '{}',
    status     text NOT NULL DEFAULT 'sent',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications.notifications (user_id, created_at DESC);

GRANT USAGE ON SCHEMA notifications TO svc_notifications;
GRANT SELECT, INSERT ON notifications.notifications TO svc_notifications;

-- ───────────── audit (append-only, chaîné par hash) ─────────────
CREATE TABLE audit.events (
    id        bigserial PRIMARY KEY,
    ts        timestamptz NOT NULL,
    service   text NOT NULL,
    action    text NOT NULL,
    actor     text,
    outcome   text NOT NULL,
    details   jsonb NOT NULL DEFAULT '{}',
    prev_hash text NOT NULL,
    hash      text NOT NULL
);
CREATE INDEX ON audit.events (ts DESC);
CREATE INDEX ON audit.events (action);

GRANT USAGE ON SCHEMA audit TO svc_audit;
GRANT SELECT, INSERT ON audit.events TO svc_audit;                    -- jamais UPDATE / DELETE / TRUNCATE
GRANT USAGE ON ALL SEQUENCES IN SCHEMA audit TO svc_audit;

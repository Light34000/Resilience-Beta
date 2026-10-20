#!/bin/bash
# Exécuté une seule fois par l'image postgres, à la création du volume.
# Un rôle et un schéma par service : un service compromis ne voit que ses propres données.
set -euo pipefail

: "${AUTH_DB_PASSWORD:?}" "${ACCOUNTS_DB_PASSWORD:?}" "${PAYMENTS_DB_PASSWORD:?}"
: "${NOTIFICATIONS_DB_PASSWORD:?}" "${AUDIT_DB_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE svc_auth          LOGIN PASSWORD '${AUTH_DB_PASSWORD}';
CREATE ROLE svc_accounts      LOGIN PASSWORD '${ACCOUNTS_DB_PASSWORD}';
CREATE ROLE svc_payments      LOGIN PASSWORD '${PAYMENTS_DB_PASSWORD}';
CREATE ROLE svc_notifications LOGIN PASSWORD '${NOTIFICATIONS_DB_PASSWORD}';
CREATE ROLE svc_audit         LOGIN PASSWORD '${AUDIT_DB_PASSWORD}';

REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${POSTGRES_DB}
  TO svc_auth, svc_accounts, svc_payments, svc_notifications, svc_audit;

CREATE SCHEMA auth;
CREATE SCHEMA accounts;
CREATE SCHEMA payments;
CREATE SCHEMA notifications;
CREATE SCHEMA audit;
SQL

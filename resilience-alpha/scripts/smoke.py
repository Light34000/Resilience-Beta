#!/usr/bin/env python3
"""Parcours de bout en bout (à lancer avant la démo) :
inscription -> connexion -> 2 comptes -> paiement -> idempotence -> refus (solde, plafond) -> notification -> audit.

  python scripts/smoke.py                       # via la passerelle http://localhost:8080
  BASE_URL=http://192.168.137.1:8080 python scripts/smoke.py
  ADMIN_PASSWORD=... python scripts/smoke.py    # vérifie aussi la chaîne d'audit
Pour tester les services un par un (sans passerelle) : AUTH_URL, ACCOUNTS_URL, PAYMENTS_URL,
NOTIFICATIONS_URL, AUDIT_URL.
"""

import os
import sys
import time
import uuid

import httpx

BASE = os.environ.get("BASE_URL", "http://localhost:8080")


def url(service: str, path: str) -> str:
    return os.environ.get(f"{service.upper()}_URL", BASE) + path


def check(condition: bool, label: str) -> None:
    print(("  OK   " if condition else "  FAIL ") + label)
    if not condition:
        sys.exit(1)


def main() -> None:
    client = httpx.Client(timeout=10)
    user, password = f"smoke-{uuid.uuid4().hex[:8]}", "Sm0ke-test-pwd"

    r = client.post(url("auth", "/api/auth/register"), json={"username": user, "password": password})
    check(r.status_code == 201, "inscription")
    r = client.post(url("auth", "/api/auth/login"), json={"username": user, "password": "mauvais-mot-de-passe"})
    check(r.status_code == 401, "mauvais mot de passe refusé")
    r = client.post(url("auth", "/api/auth/login"), json={"username": user, "password": password})
    check(r.status_code == 200, "connexion")
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = client.get(url("payments", "/api/payments"))
    check(r.status_code == 401, "API protégée sans jeton")

    a = client.post(url("accounts", "/api/accounts"), json={"initial_balance": "100.00"}, headers=headers).json()
    b = client.post(url("accounts", "/api/accounts"), json={"initial_balance": "0"}, headers=headers).json()
    check("id" in a and "id" in b, "ouverture de deux comptes")

    key = uuid.uuid4().hex
    pay = {"from_account": a["id"], "to_account": b["id"], "amount": "25.50"}
    r = client.post(url("payments", "/api/payments"), json=pay, headers={**headers, "Idempotency-Key": key})
    check(r.status_code == 201 and r.json()["status"] == "completed", "paiement de 25.50 EUR exécuté")
    r2 = client.post(url("payments", "/api/payments"), json=pay, headers={**headers, "Idempotency-Key": key})
    check(r2.status_code == 200 and r2.json()["id"] == r.json()["id"], "rejeu idempotent : même paiement, pas de double débit")

    bal_a = client.get(url("accounts", f"/api/accounts/{a['id']}"), headers=headers).json()["balance"]
    bal_b = client.get(url("accounts", f"/api/accounts/{b['id']}"), headers=headers).json()["balance"]
    check((float(bal_a), float(bal_b)) == (74.5, 25.5), f"soldes cohérents ({bal_a} / {bal_b})")

    r = client.post(url("payments", "/api/payments"), json={**pay, "amount": "999.00"}, headers={**headers, "Idempotency-Key": uuid.uuid4().hex})
    check(r.status_code in (200, 201) and r.json()["status"] == "failed", "solde insuffisant -> paiement refusé (failed)")
    r = client.post(url("payments", "/api/payments"), json={**pay, "amount": "999999.00"}, headers={**headers, "Idempotency-Key": uuid.uuid4().hex})
    check(r.status_code == 422, "plafond de montant appliqué")

    time.sleep(1)  # événements asynchrones
    notifs = client.get(url("notifications", "/api/notifications/me"), headers=headers).json()
    check(any(n["kind"] == "payment_completed" for n in notifs), "notification de paiement reçue")

    admin_pwd = os.environ.get("ADMIN_PASSWORD")
    if admin_pwd:
        tok = client.post(url("auth", "/api/auth/login"), json={"username": "admin", "password": admin_pwd}).json()["access_token"]
        v = client.get(url("audit", "/api/audit/verify"), headers={"Authorization": f"Bearer {tok}"}).json()
        check(v["valid"] and v["checked"] > 0, f"chaîne d'audit intègre ({v['checked']} événements)")
    print("Tout est OK.")


if __name__ == "__main__":
    main()

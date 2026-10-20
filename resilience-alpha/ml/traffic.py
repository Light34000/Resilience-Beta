"""Générateur de trafic pour constituer un jeu d'entraînement et évaluer le détecteur. LABORATOIRE UNIQUEMENT.

    python ml/traffic.py normal --users 6 --duration 600        # trafic légitime (base d'apprentissage)
    python ml/traffic.py bruteforce --duration 60               # attaques signées « rsl-attack-<type> »
    python ml/traffic.py scan | enumeration | flood | payspam | stuffing
    python ml/traffic.py scan --slow                           # variante discrète : débit / 5, agent « …-slow »

Chaque requête porte un agent utilisateur explicite : les attaques sont donc étiquetables sans ambiguïté
(features.label_of). Cible : BASE_URL (défaut http://localhost:8080, la passerelle).

Attention : sous Docker Desktop, la passerelle voit tous les clients avec la même IP. La force brute déclenche
alors le blocage anti-force brute d'auth pour TOUT le monde pendant 60 s (voir docs/02, section 3.1).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import time
import uuid

import httpx

BASE = os.environ.get("BASE_URL", "http://localhost:8080")


def ua(kind: str, i: int | None = None, slow: bool = False) -> str:
    if kind == "normal":
        return f"Mozilla/5.0 (rsl-normal-{i}) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"
    return f"rsl-attack-{kind}{'-slow' if slow else ''}/1.0"


async def login(c: httpx.AsyncClient, username: str, password: str, agent: str) -> str | None:
    r = await c.post("/api/auth/login", json={"username": username, "password": password}, headers={"User-Agent": agent})
    return r.json()["access_token"] if r.status_code == 200 else None


async def new_user(c: httpx.AsyncClient, agent: str) -> tuple[str, str, str | None]:
    name, pwd = f"sim-{uuid.uuid4().hex[:8]}", "Simulation-2026!"
    await c.post("/api/auth/register", json={"username": name, "password": pwd}, headers={"User-Agent": agent})
    return name, pwd, await login(c, name, pwd, agent)


# ───────────── trafic légitime ─────────────
async def normal_user(c: httpx.AsyncClient, i: int, until: float) -> int:
    agent = ua("normal", i)
    await asyncio.sleep(random.uniform(0, 8))  # arrivées étalées
    name, pwd, token = await new_user(c, agent)
    if not token:
        return 0
    h = {"Authorization": f"Bearer {token}", "User-Agent": agent}
    accounts = []
    for _ in range(2):
        r = await c.post("/api/accounts", json={"initial_balance": "800.00"}, headers=h)
        if r.status_code == 201:
            accounts.append(r.json()["id"])
    sent = 0
    while time.time() < until:
        action = random.choices(["overview", "pay", "history", "notifs", "account", "typo"], [4, 3, 2, 2, 2, 0.3])[0]
        if action == "overview":
            await c.get("/api/accounts/me", headers=h)
            await c.get("/api/payments?limit=6", headers=h)
            await c.get("/api/notifications/me?limit=5", headers=h)
        elif action == "pay" and len(accounts) == 2:
            src, dst = random.sample(accounts, 2)
            body = {"from_account": src, "to_account": dst, "amount": f"{random.uniform(1, 60):.2f}"}
            await c.post("/api/payments", json=body, headers={**h, "Idempotency-Key": str(uuid.uuid4())})
            sent += 1
        elif action == "history":
            await c.get("/api/payments?limit=200", headers=h)
        elif action == "notifs":
            await c.get("/api/notifications/me?limit=100", headers=h)
        elif action == "account" and accounts:
            await c.get(f"/api/accounts/{random.choice(accounts)}", headers=h)
        elif action == "typo":  # une faute de frappe de temps en temps, puis la bonne connexion
            await login(c, name, pwd + "x", agent)
            token = await login(c, name, pwd, agent) or token
            h["Authorization"] = f"Bearer {token}"
        await asyncio.sleep(random.uniform(2, 9))  # rythme humain
    return sent


# ───────────── attaques ─────────────
SCAN_PATHS = ["/internal/transfer", "/internal/alerts", "/admin", "/.env", "/wp-login.php", "/api/v1/users", "/docs",
              "/metrics", "/api/admin/users", "/server-status", "/api/accounts/../internal/integrity", "/phpmyadmin/", "/.git/config"]


async def attack(c: httpx.AsyncClient, kind: str, until: float, rate: float, slow: bool = False) -> int:
    agent, n = ua(kind, slow=slow), 0
    token = None
    if kind in ("enumeration", "flood", "payspam"):
        _, _, token = await new_user(c, agent)
    h = {"User-Agent": agent, **({"Authorization": f"Bearer {token}"} if token else {})}
    while time.time() < until:
        if kind == "bruteforce":
            await c.post("/api/auth/login", json={"username": "admin", "password": uuid.uuid4().hex[:10]}, headers=h)
        elif kind == "scan":
            await c.get(random.choice(SCAN_PATHS), headers=h)
        elif kind == "enumeration":
            await c.get(f"/api/{random.choice(['accounts', 'payments'])}/{uuid.uuid4()}", headers=h)
        elif kind == "flood":
            await c.get("/api/payments?limit=200", headers=h)
        elif kind == "stuffing":  # bourrage d'identifiants : beaucoup de comptes différents, un essai chacun
            await c.post("/api/auth/login", json={"username": f"user{random.randint(1, 99999)}", "password": uuid.uuid4().hex[:12]}, headers=h)
        elif kind == "payspam":
            body = {"from_account": str(uuid.uuid4()), "to_account": str(uuid.uuid4()), "amount": random.choice(["999999", "-1", "0.001", "50"])}
            await c.post("/api/payments", json=body, headers={**h, "Idempotency-Key": uuid.uuid4().hex})
        n += 1
        await asyncio.sleep(1 / rate)
    return n


RATES = {"bruteforce": 3, "scan": 6, "enumeration": 6, "flood": 15, "payspam": 5, "stuffing": 2}


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["normal", *RATES])
    p.add_argument("--duration", type=float, default=60)
    p.add_argument("--users", type=int, default=6)
    p.add_argument("--rate", type=float, default=None, help="requêtes/s pour une attaque")
    p.add_argument("--slow", action="store_true", help="attaque discrète : débit divisé par 5")
    a = p.parse_args()
    until = time.time() + a.duration
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        if a.mode == "normal":
            sent = await asyncio.gather(*(normal_user(c, i, until) for i in range(a.users)))
            print(f"trafic normal : {a.users} utilisateurs, {sum(sent)} paiements, {a.duration:.0f} s")
        else:
            rate = a.rate or RATES[a.mode] / (5 if a.slow else 1)
            n = await attack(c, a.mode, until, rate, a.slow)
            print(f"attaque {a.mode}{' (lente)' if a.slow else ''} : {n} requêtes en {a.duration:.0f} s")


if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""Génère .env à partir de .env.example en remplaçant chaque CHANGE_ME par un secret aléatoire."""

import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
template, target = ROOT / ".env.example", ROOT / ".env"

if target.exists() and "--force" not in sys.argv:
    sys.exit(".env existe déjà (utiliser --force pour le régénérer : les mots de passe de la base changeront, "
             "supprimer aussi le volume pgdata : docker compose down -v)")

lines = []
for line in template.read_text(encoding="utf-8").splitlines():
    if line.endswith("=CHANGE_ME"):
        key = line.split("=", 1)[0]
        value = secrets.token_urlsafe(48) if key == "JWT_SECRET" else secrets.token_hex(16)
        line = f"{key}={value}"
    lines.append(line)

target.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f".env généré ({target}). Compte admin : admin / voir ADMIN_PASSWORD dans .env")

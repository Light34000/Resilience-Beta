#!/usr/bin/env python3
"""Exporte la documentation OpenAPI de chaque service dans docs/api/ (livrable « documentation d'API »)."""

import importlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("JWT_SECRET", "export-only")
sys.path.insert(0, str(ROOT / "libs" / "common"))

out = ROOT / "docs" / "api"
out.mkdir(parents=True, exist_ok=True)

for service in ["auth", "accounts", "payments", "notifications", "audit", "remediation", "canary"]:
    for name in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
        del sys.modules[name]
    sys.path.insert(0, str(ROOT / "services" / service))
    module = importlib.import_module("app.main")
    sys.path.pop(0)
    (out / f"{service}.openapi.json").write_text(
        json.dumps(module.app.openapi(), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"docs/api/{service}.openapi.json")

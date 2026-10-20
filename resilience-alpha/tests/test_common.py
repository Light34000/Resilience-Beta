import json
import logging
import time

import jwt
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from resilience_common import security
from resilience_common.app import create_app
from resilience_common.logs import JsonFormatter


def test_password_hash_roundtrip():
    hashed = security.hash_password("correct horse battery")
    assert hashed != "correct horse battery"
    assert security.verify_password("correct horse battery", hashed)
    assert not security.verify_password("wrong", hashed)


def test_token_roundtrip_and_claims():
    token = security.create_token("user-1", "customer", 60, username="alice")
    claims = security.decode_token(token)
    assert claims["sub"] == "user-1" and claims["role"] == "customer" and claims["username"] == "alice"


def test_expired_token_rejected():
    token = security.create_token("user-1", "customer", -1)
    with pytest.raises(jwt.PyJWTError):
        security.decode_token(token)


def test_token_signed_with_other_secret_rejected():
    forged = jwt.encode(
        {"iss": security.ISSUER, "sub": "x", "role": "admin", "exp": int(time.time()) + 60}, "autre-secret", algorithm="HS256"
    )
    with pytest.raises(jwt.PyJWTError):
        security.decode_token(forged)


def test_json_log_format():
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "hello", None, None)
    record.fields = {"event": "demo", "status": 200}
    line = json.loads(JsonFormatter("svc").format(record))
    assert line["service"] == "svc" and line["event"] == "demo" and line["status"] == 200


def test_app_health_metrics_and_access_control():
    app = create_app("unit")

    @app.get("/admin-only")
    async def admin_only(_: dict = Depends(security.require_roles("admin"))):
        return {"ok": True}

    @app.get("/internal/only-payments")
    async def only_payments(_: dict = Depends(security.require_service("payments"))):
        return {"ok": True}

    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.get("/ready").status_code == 200  # pas de base : prêt
        assert "http_requests_total" in client.get("/metrics").text

        assert client.get("/admin-only").status_code == 401
        customer = {"Authorization": f"Bearer {security.create_token('u', 'customer', 60)}"}
        admin = {"Authorization": f"Bearer {security.create_token('u', 'admin', 60)}"}
        assert client.get("/admin-only", headers=customer).status_code == 403
        assert client.get("/admin-only", headers=admin).status_code == 200

        assert client.get("/internal/only-payments", headers=customer).status_code == 403
        assert client.get("/internal/only-payments", headers={"Authorization": f"Bearer {security.service_token('canary')}"}).status_code == 403
        assert client.get("/internal/only-payments", headers={"Authorization": f"Bearer {security.service_token('payments')}"}).status_code == 200


def test_audit_accepts_service_in_details(monkeypatch):
    # Régression : la remédiation passe service=... dans les détails (TypeError avant le correctif).
    from resilience_common import events

    sent = []
    monkeypatch.setenv("AUDIT_URL", "http://audit:8000")
    monkeypatch.setattr(events, "_fire", lambda coro: (sent.append(coro.cr_frame.f_locals["payload"]), coro.close()))
    events.audit("remediation", "incident_opened", incident_id="abc", service="payments", type="service_down")
    assert sent[0]["details"]["service"] == "payments"
    assert sent[0]["action"] == "incident_opened"

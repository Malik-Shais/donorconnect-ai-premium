import os
import tempfile

import pytest
from fastapi.testclient import TestClient

os.environ["DC_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ.pop("GEMINI_API_KEY", None)

from app import matching  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import auth  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    os.environ["DC_DB_PATH"] = str(tmp_path / "t.db")  # fresh database per test
    with TestClient(app) as c:
        auth.login_throttle.hits.clear()
        yield c


def reg(c, role="donor", email="a@x.com", **kw):
    body = dict(name="Test User", email=email, password="Passw0rdX", role=role, city="Lahore",
                blood_group="O+" if role == "donor" else None, accept_terms=True) | kw
    return c.post("/api/auth/register", json=body)


def new(email, role="donor", **kw):
    c = TestClient(app)
    assert reg(c, role, email, **kw).status_code == 201
    return c


def test_matching_rules():
    assert matching.can_give("O-", "AB+") and not matching.can_give("A+", "O+")
    assert set(matching.donors_for("AB+")) == set(matching.GROUPS)
    assert matching.donors_for("O-") == ["O-"]


def test_register_validation_and_login(client):
    assert reg(client, password="short").status_code == 422
    assert reg(client, email="bad").status_code == 422
    assert reg(client, blood_group=None).status_code == 422
    assert reg(client, accept_terms=False).status_code == 422
    assert reg(client, email="dup@x.com").status_code == 201
    assert reg(client, email="DUP@x.com").status_code == 409
    c2 = TestClient(app)
    assert c2.post("/api/auth/login", json={"email": "dup@x.com", "password": "nope"}).status_code == 401
    r = c2.post("/api/auth/login", json={"email": "dup@x.com", "password": "Passw0rdX"})
    assert r.status_code == 200 and "password" not in r.text
    assert "httponly" in r.headers["set-cookie"].lower()
    assert c2.get("/api/auth/me").json()["email"] == "dup@x.com"
    c2.post("/api/auth/logout")
    assert c2.get("/api/auth/me").status_code == 401


def test_login_lockout(client):
    for _ in range(8):
        client.post("/api/auth/login", json={"email": "x@x.com", "password": "bad"})
    assert client.post("/api/auth/login", json={"email": "x@x.com", "password": "bad"}).status_code == 429


def test_role_permissions(client):
    donor = new("d1@x.com")
    assert donor.get("/api/admin/overview").status_code == 403
    assert donor.post("/api/requests", json={}).status_code == 403
    assert TestClient(app).get("/api/donor/profile").status_code == 401
    req = new("r1@x.com", "requester")
    assert req.get("/api/donor/profile").status_code == 403


def test_full_flow_and_consent(client):
    d = new("d2@x.com", blood_group="O-")
    d_far = new("d3@x.com", blood_group="O-", city="Quetta")
    r = new("r2@x.com", "requester", phone="0300 1234567")
    rid = r.post("/api/requests", json=dict(patient_label="P.", blood_group="A+", units=2, city="Lahore",
                                           hospital="Demo Hospital", urgency="urgent")).json()["id"]
    # donor got an in-app notification (same city), far donor did not
    assert any("A+" in n["message"] for n in d.get("/api/notifications").json()["items"])
    assert not any("A+" in n["message"] for n in d_far.get("/api/notifications").json()["items"])
    detail = r.get(f"/api/requests/{rid}").json()
    ids = [m["donor_id"] for m in detail["matches"]]
    assert len(ids) == 2 and detail["matches"][0]["same_city"]  # city match ranks first
    assert "email" not in detail["matches"][0]  # no contact in matches
    # other requester cannot see it
    other = new("r3@x.com", "requester")
    assert other.get(f"/api/requests/{rid}").status_code == 404
    # invite -> donor accepts WITHOUT consent -> no contact
    assert r.post(f"/api/requests/{rid}/invite", json={"donor_id": ids[0]}).status_code == 201
    assert r.post(f"/api/requests/{rid}/invite", json={"donor_id": ids[0]}).status_code == 409
    oid = d.get("/api/donor/offers").json()[0]["id"]
    assert d.post(f"/api/donor/offers/{oid}/respond", json={"action": "accept", "share_contact": False}).status_code == 200
    o = r.get(f"/api/requests/{rid}").json()
    assert o["request"]["status"] == "matched" and o["offers"][0]["phone"] is None
    # far donor volunteers WITH consent -> contact visible
    assert d_far.post(f"/api/donor/requests/{rid}/respond", json={"share_contact": True}).status_code == 200
    offers = r.get(f"/api/requests/{rid}").json()["offers"]
    shared = [x for x in offers if x["contact_shared"]]
    assert len(shared) == 1 and shared[0]["email"] == "d3@x.com"
    # close
    assert r.patch(f"/api/requests/{rid}/status", json={"status": "fulfilled"}).status_code == 200
    assert r.patch(f"/api/requests/{rid}/status", json={"status": "cancelled"}).status_code == 409
    assert d_far.post(f"/api/donor/requests/{rid}/respond", json={}).status_code == 409


def test_incompatible_and_recent_donor(client):
    d = new("d4@x.com", blood_group="A+")
    r = new("r4@x.com", "requester")
    rid = r.post("/api/requests", json=dict(patient_label="P.", blood_group="O+", units=1, city="Lahore",
                                           hospital="Hosp", urgency="routine")).json()["id"]
    assert d.post(f"/api/donor/requests/{rid}/respond", json={}).status_code == 409
    from datetime import date
    d.put("/api/donor/profile", json=dict(blood_group="O+", city="Lahore", available=True,
                                         last_donation=date.today().isoformat()))
    assert d.post(f"/api/donor/requests/{rid}/respond", json={}).status_code == 409  # not due yet
    assert d.get("/api/donor/opportunities").json()["paused"] is True
    assert d.put("/api/donor/profile", json=dict(blood_group="O+", city="L", available=True,
                                                last_donation="2999-01-01")).status_code == 422


def test_sql_injection_and_admin(client):
    from app.db import connect
    from app.security import hash_password
    db = connect()
    db.execute("INSERT OR IGNORE INTO users(email,name,password_hash,role,city) VALUES('adm@x.com','Adm',?,'admin','X')",
               (hash_password("Passw0rdX"),))
    db.commit()
    new("v@x.com")
    a = TestClient(app)
    assert a.post("/api/auth/login", json={"email": "adm@x.com", "password": "Passw0rdX"}).status_code == 200
    assert a.get("/api/admin/users", params={"q": "' OR 1=1; DROP TABLE users;--"}).json() == []
    assert a.get("/api/admin/overview").json()["totals"]["requests"] >= 0
    assert a.get("/api/admin/reports/requests.csv").headers["content-type"].startswith("text/csv")
    victim = next(u for u in a.get("/api/admin/users").json() if u["role"] == "donor")
    assert a.patch(f"/api/admin/users/{victim['id']}", json={"active": False}).status_code == 200
    assert TestClient(app).post("/api/auth/login", json={"email": victim["email"], "password": "Passw0rdX"}).status_code == 401


def test_ai_safety_and_offline(client):
    d = new("d5@x.com")
    r = d.post("/api/ai/chat", json={"message": "Who can an O- donor give to?"}).json()
    assert r["source"] == "offline" and "AB+" in r["reply"]
    assert d.post("/api/ai/chat", json={"message": "Do I have anemia? diagnose me"}).json()["source"] == "safety"
    assert d.post("/api/ai/chat", json={"message": "I have chest pain"}).json()["source"] == "safety"
    assert d.post("/api/ai/chat", json={"message": ""}).status_code == 422
    assert TestClient(app).post("/api/ai/chat", json={"message": "hi"}).status_code == 401


def test_public_pages(client):
    assert client.get("/api/public/stats").json()["donors"] >= 0
    assert client.get("/").status_code == 200 if os.path.exists("static/index.html") else True
    assert client.get("/docs").status_code == 200

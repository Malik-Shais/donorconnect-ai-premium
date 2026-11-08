from fastapi import APIRouter, Depends, HTTPException

from .. import matching
from ..db import get_db
from ..schemas import InviteIn, RequestIn, StatusIn
from ..security import current_user, require
from .common import notify

router = APIRouter(prefix="/api/requests", tags=["requests"])


def _own(db, rid, user):
    r = db.execute("SELECT r.*, u.name AS requester_name FROM requests r JOIN users u ON u.id=r.requester_id "
                   "WHERE r.id=?", (rid,)).fetchone()
    if not r or (user["role"] != "admin" and r["requester_id"] != user["id"]):
        raise HTTPException(404, "Request not found")  # 404 avoids leaking other users' ids
    return r


@router.post("", status_code=201)
def create(body: RequestIn, user=Depends(require("requester")), db=Depends(get_db)):
    cur = db.execute(
        "INSERT INTO requests(requester_id,patient_label,blood_group,units,city,hospital,urgency,needed_by,note) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (user["id"], body.patient_label, body.blood_group, body.units, body.city, body.hospital, body.urgency,
         body.needed_by.isoformat() if body.needed_by else None, body.note))
    rid = cur.lastrowid
    db.execute("INSERT INTO request_events(request_id,status,note) VALUES(?,?,?)", (rid, "open", "Request created"))
    req = db.execute("SELECT * FROM requests WHERE id=?", (rid,)).fetchone()
    for m in matching.find_matches(db, req, limit=50):
        if m["same_city"]:
            notify(db, m["donor_id"], f"{body.urgency.title()} {body.blood_group} request at {body.hospital}, {body.city}",
                   "#/opportunities")
    db.commit()
    return {"id": rid}


@router.get("")
def list_mine(user=Depends(require("requester", "admin")), db=Depends(get_db)):
    where, args = ("", ()) if user["role"] == "admin" else ("WHERE r.requester_id=?", (user["id"],))
    rows = db.execute(
        f"SELECT r.id,r.patient_label,r.blood_group,r.units,r.city,r.hospital,r.urgency,r.status,r.created_at,"
        f"(SELECT COUNT(*) FROM offers o WHERE o.request_id=r.id AND o.status='accepted') AS accepted "
        f"FROM requests r {where} ORDER BY r.created_at DESC LIMIT 200", args).fetchall()
    return [dict(r) for r in rows]


@router.get("/{rid}")
def detail(rid: int, user=Depends(current_user), db=Depends(get_db)):
    req = _own(db, rid, user)
    offers = []
    for o in db.execute("SELECT o.*, u.name, u.email, u.phone, d.blood_group AS dbg FROM offers o "
                        "JOIN users u ON u.id=o.donor_id JOIN donors d ON d.user_id=u.id "
                        "WHERE o.request_id=? ORDER BY o.created_at", (rid,)):
        shared = o["status"] == "accepted" and o["share_contact"]  # consent gate
        offers.append({"id": o["id"], "donor_id": o["donor_id"], "name": o["name"], "blood_group": o["dbg"],
                       "origin": o["origin"], "status": o["status"], "contact_shared": bool(shared),
                       "email": o["email"] if shared else None, "phone": o["phone"] if shared else None})
    events = [dict(e) for e in db.execute(
        "SELECT status,note,created_at FROM request_events WHERE request_id=? ORDER BY id", (rid,))]
    matches = []
    if req["status"] in ("open", "matched"):
        have = {o["donor_id"] for o in offers}
        matches = [m for m in matching.find_matches(db, req) if m["donor_id"] not in have]
    return {"request": dict(req), "offers": offers, "events": events, "matches": matches}


@router.post("/{rid}/invite", status_code=201)
def invite(rid: int, body: InviteIn, user=Depends(require("requester")), db=Depends(get_db)):
    req = _own(db, rid, user)
    if req["status"] not in ("open", "matched"):
        raise HTTPException(409, "Request is closed")
    if body.donor_id not in {m["donor_id"] for m in matching.find_matches(db, req, limit=500)}:
        raise HTTPException(422, "Donor is not a current match")
    try:
        db.execute("INSERT INTO offers(request_id,donor_id,origin,status) VALUES(?,?,?,?)",
                   (rid, body.donor_id, "invited", "invited"))
    except Exception:
        raise HTTPException(409, "Donor already invited")
    notify(db, body.donor_id, f"You were invited to help with a {req['blood_group']} request at {req['hospital']}",
           "#/offers")
    db.commit()
    return {"ok": True}


@router.patch("/{rid}/status")
def set_status(rid: int, body: StatusIn, user=Depends(require("requester")), db=Depends(get_db)):
    req = _own(db, rid, user)
    if req["status"] in ("fulfilled", "cancelled"):
        raise HTTPException(409, "Request is already closed")
    if body.status == "open":
        raise HTTPException(409, "Request is already open")
    db.execute("UPDATE requests SET status=? WHERE id=?", (body.status, rid))
    db.execute("INSERT INTO request_events(request_id,status,note) VALUES(?,?,?)", (rid, body.status, body.note))
    for o in db.execute("SELECT donor_id FROM offers WHERE request_id=? AND status IN('accepted','invited')", (rid,)):
        notify(db, o["donor_id"], f"A {req['blood_group']} request you responded to is now {body.status}.", "#/offers")
    db.commit()
    return {"ok": True}

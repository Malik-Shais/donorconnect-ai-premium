from fastapi import APIRouter, Depends, HTTPException

from .. import matching
from ..db import get_db
from ..schemas import DonorProfileIn, OfferRespondIn, RespondIn
from ..security import require
from .common import notify

router = APIRouter(prefix="/api/donor", tags=["donor"])
donor_only = require("donor")
URG = "CASE r.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END"


def _profile(db, uid):
    r = db.execute("SELECT u.name,u.city,u.phone,d.* FROM donors d JOIN users u ON u.id=d.user_id "
                   "WHERE d.user_id=?", (uid,)).fetchone()
    n = matching.next_eligible(r["last_donation"])
    return {"name": r["name"], "blood_group": r["blood_group"], "city": r["city"], "phone": r["phone"],
            "available": bool(r["available"]), "last_donation": r["last_donation"],
            "next_eligible": n.isoformat() if n else None, "eligible": matching.is_eligible(r["last_donation"]),
            "can_give_to": matching.CAN_GIVE[r["blood_group"]],
            "can_receive_from": matching.donors_for(r["blood_group"])}


@router.get("/profile")
def get_profile(user=Depends(donor_only), db=Depends(get_db)):
    return _profile(db, user["id"])


@router.put("/profile")
def put_profile(body: DonorProfileIn, user=Depends(donor_only), db=Depends(get_db)):
    db.execute("UPDATE users SET city=?, phone=? WHERE id=?", (body.city, body.phone, user["id"]))
    db.execute("UPDATE donors SET blood_group=?, available=?, last_donation=? WHERE user_id=?",
               (body.blood_group, int(body.available),
                body.last_donation.isoformat() if body.last_donation else None, user["id"]))
    db.commit()
    return _profile(db, user["id"])


@router.get("/opportunities")
def opportunities(user=Depends(donor_only), db=Depends(get_db)):
    p = _profile(db, user["id"])
    if not (p["available"] and p["eligible"]):
        return {"paused": True, "items": []}
    q = ",".join("?" * len(p["can_give_to"]))
    rows = db.execute(
        f"SELECT r.id,r.blood_group,r.units,r.city,r.hospital,r.urgency,r.needed_by,r.status,r.created_at,"
        f"o.status AS my_offer FROM requests r LEFT JOIN offers o ON o.request_id=r.id AND o.donor_id=? "
        f"WHERE r.status IN('open','matched') AND r.blood_group IN ({q}) AND r.requester_id!=? "
        f"ORDER BY {URG}, r.created_at DESC LIMIT 50", (user["id"], *p["can_give_to"], user["id"])).fetchall()
    items = [{**dict(r), "city_match": r["city"].lower() == p["city"].lower()} for r in rows]
    items.sort(key=lambda i: (not i["city_match"],))  # stable: urgency order kept inside each group
    return {"paused": False, "items": items}


@router.get("/offers")
def my_offers(user=Depends(donor_only), db=Depends(get_db)):
    rows = db.execute(
        "SELECT o.id,o.origin,o.status,o.share_contact,o.created_at,r.id AS request_id,r.blood_group,r.units,"
        "r.city,r.hospital,r.urgency,r.status AS request_status FROM offers o JOIN requests r ON r.id=o.request_id "
        "WHERE o.donor_id=? ORDER BY o.created_at DESC", (user["id"],)).fetchall()
    return [dict(r) for r in rows]


def _accepted(db, req, donor, share: bool, offer_id: int | None = None):
    if req["status"] not in ("open", "matched"):
        raise HTTPException(409, "This request is no longer open")
    if not matching.is_eligible(donor["last_donation"]):
        raise HTTPException(409, f"You are not due to donate until {matching.next_eligible(donor['last_donation'])}")
    if not matching.can_give(donor["blood_group"], req["blood_group"]):
        raise HTTPException(409, "Your blood group is not preliminarily compatible with this request")
    if offer_id:
        db.execute("UPDATE offers SET status='accepted', share_contact=? WHERE id=?", (int(share), offer_id))
    else:
        db.execute("INSERT INTO offers(request_id,donor_id,origin,status,share_contact) VALUES(?,?,?,?,?) "
                   "ON CONFLICT(request_id,donor_id) DO UPDATE SET status='accepted', share_contact=excluded.share_contact",
                   (req["id"], donor["user_id"], "volunteered", "accepted", int(share)))
    if req["status"] == "open":
        db.execute("UPDATE requests SET status='matched' WHERE id=?", (req["id"],))
        db.execute("INSERT INTO request_events(request_id,status,note) VALUES(?,?,?)",
                   (req["id"], "matched", "A donor accepted"))
    notify(db, req["requester_id"], f"A donor accepted your {req['blood_group']} request"
           + (" and shared their contact details." if share else "."), f"#/requests/{req['id']}")


def _donor(db, uid):
    return db.execute("SELECT * FROM donors WHERE user_id=?", (uid,)).fetchone()


@router.post("/requests/{rid}/respond")
def volunteer(rid: int, body: RespondIn, user=Depends(donor_only), db=Depends(get_db)):
    req = db.execute("SELECT * FROM requests WHERE id=?", (rid,)).fetchone()
    if not req:
        raise HTTPException(404, "Request not found")
    _accepted(db, req, _donor(db, user["id"]), body.share_contact)
    db.commit()
    return {"ok": True}


@router.post("/offers/{oid}/respond")
def respond_offer(oid: int, body: OfferRespondIn, user=Depends(donor_only), db=Depends(get_db)):
    o = db.execute("SELECT * FROM offers WHERE id=? AND donor_id=?", (oid, user["id"])).fetchone()
    if not o:
        raise HTTPException(404, "Offer not found")
    if o["status"] != "invited":
        raise HTTPException(409, "You already responded to this invitation")
    req = db.execute("SELECT * FROM requests WHERE id=?", (o["request_id"],)).fetchone()
    if body.action == "accept":
        _accepted(db, req, _donor(db, user["id"]), body.share_contact, oid)
    else:
        db.execute("UPDATE offers SET status='declined' WHERE id=?", (oid,))
        notify(db, req["requester_id"], f"A donor declined your {req['blood_group']} invitation.",
               f"#/requests/{req['id']}")
    db.commit()
    return {"ok": True}

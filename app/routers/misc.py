import csv
import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from .. import ai, matching
from ..db import get_db
from ..schemas import AdminUserIn, ChatIn
from ..security import Throttle, current_user, require

router = APIRouter(prefix="/api", tags=["platform"])
chat_throttle = Throttle(limit=20, window=60)


@router.get("/public/stats")
def public_stats(db=Depends(get_db)):
    one = lambda q: db.execute(q).fetchone()[0]  # noqa: E731
    return {"donors": one("SELECT COUNT(*) FROM donors"),
            "available": one("SELECT COUNT(*) FROM donors WHERE available=1"),
            "requests": one("SELECT COUNT(*) FROM requests"),
            "fulfilled": one("SELECT COUNT(*) FROM requests WHERE status='fulfilled'"),
            "cities": one("SELECT COUNT(DISTINCT lower(city)) FROM users WHERE role!='admin'")}


@router.get("/analytics/supply-demand")
def supply_demand(user=Depends(current_user), db=Depends(get_db)):
    """Per recipient group: units still needed vs compatible available donors."""
    out = []
    for g in matching.GROUPS:
        gs = matching.donors_for(g)
        q = ",".join("?" * len(gs))
        donors = db.execute(f"SELECT COUNT(*) FROM donors WHERE available=1 AND blood_group IN ({q})", gs).fetchone()[0]
        units = db.execute("SELECT COALESCE(SUM(units),0) FROM requests WHERE blood_group=? AND status IN('open','matched')",
                           (g,)).fetchone()[0]
        out.append({"blood_group": g, "compatible_donors": donors, "open_units": units})
    return out


@router.get("/notifications")
def notifications(user=Depends(current_user), db=Depends(get_db)):
    rows = db.execute("SELECT id,message,link,is_read,created_at FROM notifications WHERE user_id=? "
                      "ORDER BY id DESC LIMIT 50", (user["id"],)).fetchall()
    return {"unread": sum(1 for r in rows if not r["is_read"]), "items": [dict(r) for r in rows]}


@router.post("/notifications/read", status_code=204)
def mark_read(user=Depends(current_user), db=Depends(get_db)):
    db.execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (user["id"],))
    db.commit()


@router.get("/ai/status")
def ai_status(user=Depends(current_user)):
    return {"live": ai.live()}


@router.post("/ai/chat")
def ai_chat(body: ChatIn, user=Depends(current_user), db=Depends(get_db)):
    chat_throttle.check(str(user["id"]))
    return ai.reply(body.message, user, db)


# ---- admin ----
admin = require("admin")


@router.get("/admin/overview")
def overview(_=Depends(admin), db=Depends(get_db)):
    rows = lambda q: [dict(r) for r in db.execute(q)]  # noqa: E731
    one = lambda q: db.execute(q).fetchone()[0]  # noqa: E731
    total, done = one("SELECT COUNT(*) FROM requests"), one("SELECT COUNT(*) FROM requests WHERE status='fulfilled'")
    return {
        "users": rows("SELECT role, COUNT(*) AS n FROM users GROUP BY role"),
        "totals": {"requests": total, "fulfilled": done, "fulfilment_rate": round(100 * done / total) if total else 0,
                   "available_donors": one("SELECT COUNT(*) FROM donors WHERE available=1"),
                   "acceptances": one("SELECT COUNT(*) FROM offers WHERE status='accepted'")},
        "by_status": rows("SELECT status, COUNT(*) AS n FROM requests GROUP BY status"),
        "by_urgency": rows("SELECT urgency, COUNT(*) AS n FROM requests GROUP BY urgency"),
        "by_group": rows("SELECT blood_group, COUNT(*) AS n FROM requests GROUP BY blood_group ORDER BY n DESC"),
        "donors_by_group": rows("SELECT blood_group, COUNT(*) AS n FROM donors GROUP BY blood_group ORDER BY n DESC"),
        "top_cities": rows("SELECT city, COUNT(*) AS n FROM requests GROUP BY lower(city) ORDER BY n DESC LIMIT 6"),
        "per_day": rows("SELECT date(created_at) AS day, COUNT(*) AS n FROM requests "
                        "WHERE created_at >= date('now','-13 days') GROUP BY day ORDER BY day"),
    }


@router.get("/admin/users")
def users(q: str = "", _=Depends(admin), db=Depends(get_db)):
    like = f"%{q.strip()[:50]}%"
    return [dict(r) for r in db.execute(
        "SELECT id,name,email,role,city,active,created_at FROM users WHERE name LIKE ? OR email LIKE ? "
        "OR city LIKE ? ORDER BY id DESC LIMIT 200", (like, like, like))]


@router.patch("/admin/users/{uid}")
def set_active(uid: int, body: AdminUserIn, me=Depends(admin), db=Depends(get_db)):
    if uid == me["id"]:
        raise HTTPException(409, "You cannot deactivate your own account")
    if db.execute("UPDATE users SET active=? WHERE id=?", (int(body.active), uid)).rowcount == 0:
        raise HTTPException(404, "User not found")
    if not body.active:
        db.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    db.commit()
    return {"ok": True}


def _safe(v):
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in "=+-@\t\r" and s else s  # block CSV/formula injection


@router.get("/admin/reports/requests.csv")
def report(_=Depends(admin), db=Depends(get_db)):
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["id", "created_at", "blood_group", "units", "city", "hospital", "urgency", "status", "accepted_offers"]
    w.writerow(cols)
    for r in db.execute("SELECT r.id,r.created_at,r.blood_group,r.units,r.city,r.hospital,r.urgency,r.status,"
                        "(SELECT COUNT(*) FROM offers o WHERE o.request_id=r.id AND o.status='accepted') "
                        "FROM requests r ORDER BY r.id"):
        w.writerow([_safe(v) for v in tuple(r)])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=donorconnect-requests.csv"})

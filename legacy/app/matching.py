"""Preliminary red-cell blood group compatibility + location matching.
Informational only: final compatibility is always confirmed by a blood bank / clinician."""
from datetime import date, timedelta

GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"]
# donor group -> recipient groups that can receive its red cells
CAN_GIVE = {
    "O-": GROUPS,
    "O+": ["O+", "A+", "B+", "AB+"],
    "A-": ["A-", "A+", "AB-", "AB+"],
    "A+": ["A+", "AB+"],
    "B-": ["B-", "B+", "AB-", "AB+"],
    "B+": ["B+", "AB+"],
    "AB-": ["AB-", "AB+"],
    "AB+": ["AB+"],
}
INTERVAL_DAYS = 56  # common whole-blood interval; local rules vary


def donors_for(recipient: str) -> list[str]:
    return [d for d, rs in CAN_GIVE.items() if recipient in rs]


def can_give(donor: str, recipient: str) -> bool:
    return recipient in CAN_GIVE.get(donor, [])


def next_eligible(last_donation: str | None) -> date | None:
    return date.fromisoformat(last_donation) + timedelta(days=INTERVAL_DAYS) if last_donation else None


def is_eligible(last_donation: str | None) -> bool:
    n = next_eligible(last_donation)
    return n is None or n <= date.today()


def score(donor_group: str, recipient: str, same_city: bool) -> int:
    return (40 if same_city else 0) + (30 if donor_group == recipient else 20)


def find_matches(db, req, limit: int = 30) -> list[dict]:
    """Available, eligible, compatible donors; ranked by city then exact group."""
    groups = donors_for(req["blood_group"])
    q = ",".join("?" * len(groups))
    rows = db.execute(
        f"SELECT u.id, u.name, u.city, d.blood_group, d.last_donation FROM donors d "
        f"JOIN users u ON u.id=d.user_id WHERE u.active=1 AND d.available=1 "
        f"AND d.blood_group IN ({q}) AND u.id!=?", (*groups, req["requester_id"])).fetchall()
    out = []
    for r in rows:
        if not is_eligible(r["last_donation"]):
            continue
        same = r["city"].strip().lower() == req["city"].strip().lower()
        first, *rest = r["name"].split()
        out.append({"donor_id": r["id"], "display": f"{first} {rest[-1][0]}." if rest else first,
                    "blood_group": r["blood_group"], "city": r["city"], "same_city": same,
                    "score": score(r["blood_group"], req["blood_group"], same)})
    out.sort(key=lambda m: -m["score"])
    return out[:limit]

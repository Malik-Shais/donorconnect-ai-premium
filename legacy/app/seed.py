"""Fictional demonstration data. Run: python -m app.seed   (refuses to run on a non-empty database)."""
import random
from datetime import date, timedelta

from . import matching
from .db import connect, init_db
from .routers.common import notify
from .security import hash_password

DEMO_PASSWORD = "Demo@12345"  # fictional demo accounts only
CITIES = ["Karachi", "Lahore", "Islamabad", "Peshawar"]
HOSPITALS = {"Karachi": "Demo City Hospital", "Lahore": "Sample General Hospital",
             "Islamabad": "Example Medical Centre", "Peshawar": "Mock Teaching Hospital"}
GROUPS = ["O+", "O+", "A+", "A+", "B+", "B+", "O-", "A-", "B-", "AB+", "AB-"]
NAMES = ["Ayesha Khan", "Bilal Ahmed", "Chaman Lal", "Dania Siddiqui", "Eman Raza", "Farhan Ali", "Hina Malik",
         "Imran Shah", "Jaweria Noor", "Kamran Butt", "Laiba Tariq", "Mustafa Iqbal", "Nimra Aziz", "Omar Farooq",
         "Pari Gul", "Qasim Rana", "Rabia Sheikh", "Saad Hashmi", "Tahira Bano", "Usman Ghani"]


def seed() -> None:
    init_db()
    db = connect()
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        raise SystemExit("Database already has data; aborting.")
    rnd = random.Random(7)
    pw = hash_password(DEMO_PASSWORD)
    add = lambda e, n, r, c, p=None: db.execute(  # noqa: E731
        "INSERT INTO users(email,name,password_hash,role,city,phone) VALUES(?,?,?,?,?,?)", (e, n, pw, r, c, p)).lastrowid
    add("admin@demo.example", "Demo Admin", "admin", "Karachi")
    reqs = [add(f"requester{i}@demo.example", n, "requester", CITIES[i % 4], f"+92-300-000{i:04d}")
            for i, n in enumerate(["Sana Demo", "Zain Demo", "Mehr Demo"])]
    for i, n in enumerate(NAMES):
        uid = add(f"donor{i + 1}@demo.example", n, "donor", CITIES[i % 4], f"+92-311-100{i:04d}")
        last = (date.today() - timedelta(days=rnd.choice([None, 20, 70, 120, 200]) or 0)).isoformat() \
            if rnd.random() > 0.3 else None
        if i == 0:  # donor1 is the "happy path" demo login: available and eligible
            last = None
        db.execute("INSERT INTO donors VALUES(?,?,?,?)", (uid, GROUPS[i % len(GROUPS)], 1 if i == 0 else int(rnd.random() > 0.2), last))
    specs = [(0, "A+", 2, "urgent", "open"), (1, "O-", 1, "critical", "open"), (2, "B+", 3, "routine", "matched"),
             (0, "O+", 2, "urgent", "fulfilled"), (1, "AB+", 1, "routine", "cancelled"), (2, "A-", 1, "urgent", "open")]
    for k, (ri, bg, units, urg, st) in enumerate(specs):
        city = CITIES[ri % 4]
        days_ago = k * 2
        rid = db.execute(
            "INSERT INTO requests(requester_id,patient_label,blood_group,units,city,hospital,urgency,status,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,datetime('now',?))",
            (reqs[ri], f"Patient {chr(65 + k)}.", bg, units, city, HOSPITALS[city], urg, st, f"-{days_ago} days")).lastrowid
        db.execute("INSERT INTO request_events(request_id,status,note) VALUES(?,?,?)", (rid, "open", "Request created"))
        if st != "open":
            db.execute("INSERT INTO request_events(request_id,status,note) VALUES(?,?,?)", (rid, st, "Demo status"))
        if st in ("matched", "fulfilled"):
            donor = db.execute(  # a genuinely compatible donor, so demo data stays coherent
                f"SELECT user_id FROM donors WHERE blood_group IN ({','.join('?' * len(matching.donors_for(bg)))}) "
                "ORDER BY user_id LIMIT 1", matching.donors_for(bg)).fetchone()[0]
            db.execute("INSERT INTO offers(request_id,donor_id,origin,status,share_contact) VALUES(?,?,?,?,1)",
                       (rid, donor, "volunteered", "accepted"))
    notify(db, reqs[0], "Demo data loaded. Explore your requests.", "#/requests")
    db.commit()
    print(f"Seeded. Demo logins (password {DEMO_PASSWORD}): admin@demo.example, requester0@demo.example, donor1@demo.example")


if __name__ == "__main__":
    seed()

def notify(db, user_id: int, message: str, link: str | None = None) -> None:
    db.execute("INSERT INTO notifications(user_id,message,link) VALUES(?,?,?)", (user_id, message, link))


def public_user(u) -> dict:
    return {k: u[k] for k in ("id", "name", "email", "role", "city", "phone")}

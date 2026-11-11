import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException

from .config import env
from .db import get_db

COOKIE = "dc_session"
SESSION_DAYS = 7
_DUMMY = None


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"


def verify_password(pw: str, stored: str | None) -> bool:
    global _DUMMY
    if stored is None:  # burn equal time for unknown users
        _DUMMY = _DUMMY or hash_password("dummy-password-1")
        stored = _DUMMY
        hmac.compare_digest("a", "b")
    try:
        _, salt, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
        return hmac.compare_digest(calc.hex(), h)
    except ValueError:
        return False


def _hash_token(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def create_session(db, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    exp = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    db.execute("DELETE FROM sessions WHERE expires_at < ?", (_now(),))
    db.execute("INSERT INTO sessions VALUES(?,?,?)", (_hash_token(token), user_id, exp))
    db.commit()
    return token


def cookie_kwargs() -> dict:
    return dict(httponly=True, samesite="strict", secure=env("DC_COOKIE_SECURE") == "1",
                max_age=SESSION_DAYS * 86400, path="/")


def end_session(db, token: str | None) -> None:
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (_hash_token(token),))
        db.commit()


def current_user(dc_session: str | None = Cookie(default=None), db=Depends(get_db)):
    if not dc_session:
        raise HTTPException(401, "Please sign in")
    row = db.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id "
        "WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
        (_hash_token(dc_session), _now())).fetchone()
    if not row:
        raise HTTPException(401, "Session expired")
    return row


def require(*roles: str):
    def dep(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Not allowed for your role")
        return user
    return dep


class Throttle:
    """In-memory sliding window. shortcut: per-process only, use a shared store if scaled out."""

    def __init__(self, limit: int, window: int):
        self.limit, self.window, self.hits = limit, window, {}

    def check(self, key: str, count: bool = True) -> None:
        now = time.time()
        recent = [t for t in self.hits.get(key, []) if now - t < self.window]
        if len(recent) >= self.limit:
            self.hits[key] = recent
            raise HTTPException(429, "Too many attempts. Please wait a few minutes.")
        if count:
            recent.append(now)
        self.hits[key] = recent

    def reset(self, key: str) -> None:
        self.hits.pop(key, None)

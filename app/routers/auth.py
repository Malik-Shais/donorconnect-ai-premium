import sqlite3

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response

from ..db import get_db
from ..schemas import LoginIn, RegisterIn
from ..security import (COOKIE, Throttle, cookie_kwargs, create_session, current_user, end_session,
                        hash_password, verify_password)
from .common import notify, public_user

router = APIRouter(prefix="/api/auth", tags=["auth"])
login_throttle = Throttle(limit=8, window=600)


@router.post("/register", status_code=201)
def register(body: RegisterIn, response: Response, db=Depends(get_db)):
    if body.role == "donor" and not body.blood_group:
        raise HTTPException(422, "Blood group is required for donors")
    try:
        cur = db.execute(
            "INSERT INTO users(email,name,password_hash,role,city,phone) VALUES(?,?,?,?,?,?)",
            (body.email, body.name, hash_password(body.password), body.role, body.city, body.phone))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "An account with this email already exists")
    uid = cur.lastrowid
    if body.role == "donor":
        db.execute("INSERT INTO donors(user_id,blood_group) VALUES(?,?)", (uid, body.blood_group))
    notify(db, uid, "Welcome to DonorConnect AI. Complete your profile to get started.", "#/dashboard")
    db.commit()
    response.set_cookie(COOKIE, create_session(db, uid), **cookie_kwargs())
    return public_user(db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db=Depends(get_db)):
    key = f"{body.email.lower()}|{request.client.host if request.client else ''}"
    login_throttle.check(key, count=False)
    u = db.execute("SELECT * FROM users WHERE email=?", (body.email.strip(),)).fetchone()
    ok = verify_password(body.password, u["password_hash"] if u else None)
    if not (u and ok and u["active"]):
        login_throttle.check(key)  # count only failures
        raise HTTPException(401, "Incorrect email or password")
    login_throttle.reset(key)
    response.set_cookie(COOKIE, create_session(db, u["id"]), **cookie_kwargs())
    return public_user(u)


@router.post("/logout", status_code=204)
def logout(response: Response, dc_session: str | None = Cookie(default=None), db=Depends(get_db)):
    end_session(db, dc_session)
    response.delete_cookie(COOKIE, path="/")


@router.get("/me")
def me(user=Depends(current_user)):
    return public_user(user)

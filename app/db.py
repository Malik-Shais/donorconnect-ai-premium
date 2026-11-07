import sqlite3
from pathlib import Path

from .config import ROOT, env

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('donor','requester','admin')),
  city TEXT NOT NULL,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS donors(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blood_group TEXT NOT NULL CHECK(blood_group IN('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  available INTEGER NOT NULL DEFAULT 1,
  last_donation TEXT);
CREATE TABLE IF NOT EXISTS requests(
  id INTEGER PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  patient_label TEXT NOT NULL,
  blood_group TEXT NOT NULL,
  units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 10),
  city TEXT NOT NULL,
  hospital TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK(urgency IN('routine','urgent','critical')),
  needed_by TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','matched','fulfilled','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS request_events(
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL, note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS offers(
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  donor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK(origin IN('invited','volunteered')),
  status TEXT NOT NULL CHECK(status IN('invited','accepted','declined')),
  share_contact INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id, donor_id));
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL, link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_req_status ON requests(status, blood_group, city);
CREATE INDEX IF NOT EXISTS ix_donor_bg ON donors(blood_group, available);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, is_read);
"""


def db_path() -> str:
    p = Path(env("DC_DB_PATH", str(ROOT / "data" / "donorconnect.db")))
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with connect() as c:
        c.executescript(SCHEMA)


def get_db():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()

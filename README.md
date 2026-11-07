# DonorConnect AI Premium

Mobile-first blood donor coordination web app. **Python · FastAPI · SQLite · vanilla HTML/CSS/JS.** Zero paid services.

> Matching is *preliminary*. The app gives no medical diagnoses or transfusion decisions; hospitals and blood banks confirm everything.

## Features
Premium landing page with live stats · secure register/login (scrypt hashing, HttpOnly SameSite cookie sessions, login lockout) · donor, requester and admin dashboards · donor availability + 56-day eligibility pause · blood-group (red-cell) + city matching · requests with status timeline · **consent-based contact sharing** (contact is released only when a donor accepts *and* ticks consent) · in-app notifications · supply/demand analytics, admin reports and CSV export · AI assistant (Google Gemini free tier via the Python backend, with an offline fallback and safety filters).

## Run locally
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional; add GEMINI_API_KEY for live AI
python -m app.seed              # fictional demo data (optional)
uvicorn app.main:app --reload
```
Open **http://localhost:8000** (app) and **http://localhost:8000/docs** (Swagger UI).

Demo logins (fictional, password `Demo@12345`): `admin@demo.example`, `requester0@demo.example`, `donor1@demo.example`.
Remote/cloud preview: forward port 8000 and open the forwarded URL.

## Live AI (optional, free)
Create a free key at https://aistudio.google.com/apikey, put it in `.env` as `GEMINI_API_KEY`. The key stays server-side and is never sent to the browser. Without a key (or if the API fails) the offline assistant answers. Never commit `.env`.

## Tests
```bash
python -m pytest -q
```

## Layout
`app/` backend (`routers/`, `matching.py`, `ai.py`, `security.py`, `db.py`, `seed.py`) · `static/` frontend · `tests/` · `docs/ARCHITECTURE.md` design, schema, screens, roadmap.

## Known limits
Rate limiting is in-memory (single process). SQLite suits a single node. Set `DC_COOKIE_SECURE=1` behind HTTPS. Demonstration software, not a certified medical system.

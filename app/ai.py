"""AI assistant. Server-side only: the API key never reaches the browser.
Live mode uses Google Gemini's free tier (GEMINI_API_KEY); otherwise a deterministic offline assistant answers."""
import json
import re
import urllib.error
import urllib.request

from . import matching
from .config import env

SYSTEM = (
    "You are the DonorConnect assistant for a blood-donor coordination app. Help users understand how the app works, "
    "general (non-personal) donation information, preparing for donation, and using the matching tools. "
    "Strictly: never diagnose, never advise on whether someone needs or should receive a transfusion, never interpret "
    "lab results, never confirm medical eligibility or blood compatibility as final. Matching in this app is "
    "preliminary; blood banks and clinicians decide. For symptoms or emergencies tell the user to contact a doctor or "
    "local emergency services. Never ask for or repeat personal contact details. Keep answers under 150 words."
)
EMERGENCY = re.compile(r"\b(emergency|bleeding|chest pain|unconscious|overdose|suicid|can'?t breathe|dying)\b", re.I)
MEDICAL = re.compile(r"\b(diagnos|do i have|should i (get|receive|take) .*transfus|need a transfusion|my (lab|test) result|"
                     r"prescri|dosage|medication)\b", re.I)
EMERGENCY_MSG = ("This sounds urgent. Please contact your local emergency services or the nearest hospital right now. "
                 "DonorConnect cannot handle medical emergencies.")
MEDICAL_MSG = ("I can't give medical diagnoses or transfusion advice. Please speak to a doctor or your hospital's blood "
               "bank. I can help with how DonorConnect works or general donation information.")
DISCLAIMER = "Preliminary information only, not medical advice."


def live() -> bool:
    return bool(env("GEMINI_API_KEY"))


def _offline(msg: str, user) -> str:
    m = msg.lower()
    g = re.search(r"\b(ab|a|b|o)\s?([+-]|pos(?:itive)?|neg(?:ative)?)", m)
    if g and ("give" in m or "donate" in m or "receive" in m or "compat" in m or "match" in m):
        grp = g.group(1).upper() + ("+" if g.group(2).startswith(("+", "pos")) else "-")
        return (f"{grp} red cells can preliminarily go to: {', '.join(matching.CAN_GIVE[grp])}. "
                f"{grp} recipients can preliminarily receive from: {', '.join(matching.donors_for(grp))}. "
                "A blood bank confirms real compatibility.")
    if any(w in m for w in ("eligib", "how often", "interval", "again")):
        return (f"Many centres ask whole-blood donors to wait about {matching.INTERVAL_DAYS} days between donations. "
                "DonorConnect uses that to pause matching after your last donation; your local blood bank's rules decide.")
    if any(w in m for w in ("prepare", "before", "eat", "drink", "after")):
        return ("General tips: stay hydrated, eat a normal meal beforehand, bring ID, and rest afterwards. "
                "Follow instructions from the donation centre staff.")
    if any(w in m for w in ("contact", "privacy", "share", "consent")):
        return ("Your phone and email stay hidden. They are shown to a requester only if you accept a request and "
                "tick the consent box for that specific request.")
    if any(w in m for w in ("how", "work", "start", "help", "what")):
        role = {"donor": "Set your availability, then accept requests under Opportunities.",
                "requester": "Create a request, review matched donors, invite them, and track status.",
                "admin": "Use the Admin pages for analytics, users and CSV reports."}[user["role"]]
        return f"DonorConnect matches blood requests with nearby, compatible, available donors. {role}"
    return ("I can explain blood-group compatibility, donation intervals, preparation tips, consent and how the app "
            "works. Try: 'Who can an O- donor give to?'")


def _gemini(msg: str, user, db) -> str:
    ctx = f"User role: {user['role']}."
    d = db.execute("SELECT blood_group FROM donors WHERE user_id=?", (user["id"],)).fetchone()
    if d:
        ctx += f" Donor blood group: {d['blood_group']}."
    model = env("GEMINI_MODEL", "gemini-2.0-flash")
    body = json.dumps({"systemInstruction": {"parts": [{"text": SYSTEM + " " + ctx}]},
                       "contents": [{"role": "user", "parts": [{"text": msg}]}],
                       "generationConfig": {"maxOutputTokens": 300, "temperature": 0.3}}).encode()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": env("GEMINI_API_KEY")})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.load(r)
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def reply(msg: str, user, db) -> dict:
    if EMERGENCY.search(msg):
        return {"reply": EMERGENCY_MSG, "source": "safety", "disclaimer": DISCLAIMER}
    if MEDICAL.search(msg):
        return {"reply": MEDICAL_MSG, "source": "safety", "disclaimer": DISCLAIMER}
    if live():
        try:
            return {"reply": _gemini(msg, user, db), "source": "gemini", "disclaimer": DISCLAIMER}
        except (urllib.error.URLError, KeyError, IndexError, ValueError, TimeoutError):
            pass  # fall through to offline so the feature degrades instead of failing
    return {"reply": _offline(msg, user), "source": "offline", "disclaimer": DISCLAIMER}

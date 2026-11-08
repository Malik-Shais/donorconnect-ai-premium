// DEVELOPMENT-ONLY seed: fictional accounts and data. Refuses to run unless the API URL is local.
// Uses the service-role key (read from git-ignored .env.local), which exists nowhere in the web app.
import { readFileSync } from "node:fs";

const parse = (f) => Object.fromEntries(readFileSync(f, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const URL_ = parse(".env.local").NEXT_PUBLIC_SUPABASE_URL, KEY = parse("supabase/.env.dev").SUPABASE_SERVICE_ROLE_KEY; // service key lives only in supabase/.env.dev
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_ ?? "")) { console.error(`Refusing to seed non-local target: ${URL_}`); process.exit(1); }
const PASSWORD = "Demo@12345"; // fictional dev-only credential, documented in the README
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const call = async (path, opts = {}) => { const r = await fetch(URL_ + path, { ...opts, headers: { ...H, ...opts.headers } }); const t = await r.text(); return { ok: r.ok, status: r.status, body: t ? JSON.parse(t) : null }; };

const people = [
  ["admin@demo.example", "Demo Admin", "admin", "Karachi"],
  ["requester1@demo.example", "Sana Demo", "requester", "Karachi"], ["requester2@demo.example", "Zain Demo", "requester", "Lahore"],
  ...[["O+", "Karachi"], ["A+", "Karachi"], ["B+", "Lahore"], ["O-", "Lahore"], ["A-", "Islamabad"], ["AB+", "Karachi"], ["B-", "Islamabad"], ["O+", "Lahore"]]
    .map(([bg, city], i) => [`donor${i + 1}@demo.example`, ["Ayesha Khan", "Bilal Ahmed", "Chaman Lal", "Dania Siddiqui", "Eman Raza", "Farhan Ali", "Hina Malik", "Imran Shah"][i], "donor", city, bg]),
];

const ids = {};
for (const [email, full_name, role, city, blood_group] of people) {
  const meta = { full_name, city, phone: "+92 300 000 " + String(Object.keys(ids).length).padStart(4, "0"), role: role === "admin" ? "requester" : role, ...(blood_group && { blood_group }) };
  let r = await call("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: meta }) });
  if (!r.ok) { // already seeded: look the user up instead
    const list = await call("/auth/v1/admin/users?per_page=200");
    r = { ok: true, body: list.body.users.find((u) => u.email === email) };
  }
  ids[email] = r.body.id;
}
// Admin is granted ONLY here, by the privileged script, never through signup.
await call(`/rest/v1/profiles?id=eq.${ids["admin@demo.example"]}`, { method: "PATCH", body: JSON.stringify({ role: "admin" }) });

const existing = await call("/rest/v1/blood_requests?select=id&limit=1");
if (existing.body.length === 0) {
  const reqs = [
    ["requester1@demo.example", "Patient A.", "A+", 2, "Karachi", "Demo City Hospital", "urgent"],
    ["requester1@demo.example", "Patient B.", "O-", 1, "Lahore", "Sample General Hospital", "critical"],
    ["requester2@demo.example", "Patient C.", "B+", 3, "Lahore", "Example Medical Centre", "routine"],
    ["requester2@demo.example", "Patient D.", "AB+", 1, "Karachi", "Demo City Hospital", "urgent"],
  ];
  for (const [i, [who, patient_label, blood_group, units, city, hospital, urgency]] of reqs.entries()) {
    const created = await call("/rest/v1/blood_requests", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ requester_id: ids[who], patient_label, blood_group, units, city, hospital, urgency }) });
    // New requests start as pending_review (database default). Approve the first three; leave one in the admin queue.
    if (i < 3) await call(`/rest/v1/blood_requests?id=eq.${created.body[0].id}`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
  }
}
console.log(`Seeded ${people.length} fictional accounts (password: ${PASSWORD}):\n  admin@demo.example, requester1@demo.example, donor1@demo.example ...`);

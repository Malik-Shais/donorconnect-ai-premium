// Stage 4 browser tests: notification center, LIVE realtime (real WebSocket), polling fallback, reconnect, email via Mailpit,
// UI rate limits, service-worker privacy and security headers. Requires `npm run db:up && npm run db:seed`.
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { adminApprove, newAdmin, newUser, register, stamp, submitRequest, uniq } from "./helpers";

const MAIL = process.env.MAILPIT_URL;
/** The outbox rows for a recipient (status / attempts / error CODE only): used both as the server-side completion check and for failure diagnostics. */
async function outboxRows(email: string) {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await c.connect();
  try { return (await c.query("select o.status, o.attempts, o.last_error, o.next_attempt_at > now() as backed_off from public.email_outbox o join auth.users u on u.id=o.user_id where u.email=$1 order by o.id", [email.toLowerCase()])).rows as { status: string; attempts: number; last_error: string | null; backed_off: boolean }[]; }
  finally { await c.end(); }
}
/** Queue `n` emails for an opted-in recipient: a deterministic backlog that sits AHEAD of the test's own row (regression for single-batch workers). */
async function queueBacklog(email: string, n: number) {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await c.connect();
  try {
    await c.query("insert into public.notification_preferences (user_id, email_enabled) select id, true from auth.users where email=$1", [email.toLowerCase()]);
    await c.query("insert into public.notifications (user_id, message, dedupe_key) select id, 'backlog', 'req:'||g||':bk' from auth.users, generate_series(1,$2) g where email=$1", [email.toLowerCase(), n]);
  } finally { await c.end(); }
}
/** Wait for the SERVER-SIDE fact (outbox row sent), then read Mailpit. A failure reports the row state and the Mailpit count at that moment. */
async function waitForDelivery(email: string) {
  try {
    await expect.poll(async () => (await outboxRows(email)).map((r) => r.status), { timeout: 20_000 }).toEqual(["sent"]);
    let count = 0;
    await expect.poll(async () => { count = ((await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()).messages ?? []).length; return count; }, { timeout: 10_000 }).toBe(1);
  } catch (e) {
    const found = ((await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()).messages ?? []).length;
    throw new Error(`${(e as Error).message}\noutbox=${JSON.stringify(await outboxRows(email))} mailpit_messages=${found}`);
  }
}
const status = (p: Page) => p.getByTestId("live-status");
const badge = (p: Page) => p.locator('[data-testid="unread-badge"]:visible');
const donorIn = (browser: Parameters<typeof newUser>[0], city: string, tag: string) => newUser(browser, { email: uniq(tag), name: `Dee ${tag}`, city, group: "O+" });

/** A requester posts + admin approves a request in `city`; returns the donor-visible notification text. */
async function publishRequest(browser: Parameters<typeof newUser>[0], admin: Page, city: string, s: string) {
  const requester = await newUser(browser, { email: uniq("rq"), role: "requester", city });
  const hospital = `Notify Hospital ${s}${Math.random().toString(36).slice(2, 5)}`;
  await submitRequest(requester.page, { hospital, city });
  await adminApprove(admin, hospital);
  await requester.ctx.close();
  return { hospital, text: `Urgent A+ request in ${city}` };
}

test.describe("notification center", () => {
  test("unread counter, categories, mark-as-read, mark-all and empty states", async ({ browser }) => {
    const s = stamp(), city = `Cn${s}`;
    const donor = await donorIn(browser, city, "nc"), admin = await newAdmin(browser);
    await donor.page.goto("/dashboard/donor/notifications");
    await expect(donor.page.getByTestId("unread-summary")).toHaveText("1 unread");
    await expect(badge(donor.page)).toHaveText("1");
    await expect(donor.page.getByText("Welcome to DonorConnect AI")).toBeVisible();
    await expect(donor.page.getByText("Account", { exact: true }).first()).toBeVisible(); // category chip + filter
    await publishRequest(browser, admin.page, city, s);
    await expect(donor.page.getByTestId("unread-summary")).toHaveText("2 unread", { timeout: 25_000 });
    await expect(badge(donor.page)).toHaveText("2");

    await donor.page.getByRole("button", { name: "Requests", exact: true }).click(); // category filter
    await expect(donor.page.getByRole("list", { name: "Notifications" }).getByRole("listitem")).toHaveCount(1);
    await donor.page.getByRole("button", { name: "Mark as read" }).click();
    await expect(donor.page.getByTestId("unread-summary")).toHaveText("1 unread");
    await donor.page.getByRole("button", { name: /^Unread/ }).click();
    await expect(donor.page.getByText("Welcome to DonorConnect AI")).toBeVisible(); // the remaining unread one
    await donor.page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(donor.page.getByTestId("unread-summary")).toHaveText("You're all caught up.");
    await expect(donor.page.getByText("No notifications match this filter.")).toBeVisible(); // Unread filter is now empty
    await expect(badge(donor.page)).toHaveCount(0);
    // The UI updates optimistically and Server Actions run one at a time: wait until the server has really persisted it before reloading.
    await expect.poll(async () => (await (await donor.page.request.get("/api/notifications")).json()).unread).toBe(0);
    await donor.page.reload(); // persisted server-side
    await expect(donor.page.getByTestId("unread-summary")).toHaveText("You're all caught up.");
    for (const u of [donor, admin]) await u.ctx.close();
  });

  test("filtering an empty list shows the empty state", async ({ browser }) => {
    const r = await newUser(browser, { email: uniq("em"), role: "requester", city: `Ce${stamp()}` });
    await r.page.goto("/dashboard/requester/notifications");
    await r.page.getByRole("button", { name: "Mark all as read" }).click();
    await r.page.getByRole("button", { name: /^Unread/ }).click();
    await expect(r.page.getByText("No notifications match this filter.")).toBeVisible();
    await r.ctx.close();
  });
});

test.describe("realtime (live WebSocket) and fallbacks", () => {
  test.setTimeout(120_000);

  test("LIVE: a new notification appears without reloading the page", async ({ browser }) => {
    const s = stamp(), city = `Cl${s}`;
    const donor = await donorIn(browser, city, "live"), admin = await newAdmin(browser);
    await donor.page.goto("/dashboard/donor/notifications");
    await expect(status(donor.page)).toHaveAttribute("data-state", "live", { timeout: 20_000 });
    await expect(status(donor.page)).toContainText("Live updates on");
    let navigations = 0; donor.page.on("framenavigated", () => navigations++);
    const { text } = await publishRequest(browser, admin.page, city, s);
    await expect(donor.page.getByText(text)).toBeVisible({ timeout: 15_000 }); // delivered by the push, well before any 20/120 s poll
    expect(navigations).toBe(0);
    await expect(badge(donor.page)).toHaveText("2");
    for (const u of [donor, admin]) await u.ctx.close();
  });

  test("FALLBACK: with the WebSocket blocked the page polls and still receives notifications", async ({ browser }) => {
    const s = stamp(), city = `Cf${s}`;
    const donor = await donorIn(browser, city, "poll"), admin = await newAdmin(browser);
    await donor.page.routeWebSocket(/realtime/, (ws) => ws.close()); // realtime unavailable
    await donor.page.goto("/dashboard/donor/notifications");
    await expect(status(donor.page)).toHaveAttribute("data-state", "polling", { timeout: 30_000 });
    await expect(status(donor.page)).toContainText("checking every 20 seconds");
    const { text } = await publishRequest(browser, admin.page, city, s);
    await expect(donor.page.getByText(text)).toBeVisible({ timeout: 40_000 }); // arrives via the 20 s poll
    for (const u of [donor, admin]) await u.ctx.close();
  });

  test("RECONNECT: offline banner, then reconnect and catch up on what was missed", async ({ browser }) => {
    const s = stamp(), city = `Cr${s}`;
    const donor = await donorIn(browser, city, "recon"), admin = await newAdmin(browser);
    await donor.page.goto("/dashboard/donor/notifications");
    await expect(status(donor.page)).toHaveAttribute("data-state", "live", { timeout: 20_000 });
    await donor.ctx.setOffline(true);
    await expect(status(donor.page)).toHaveAttribute("data-state", "offline");
    await expect(donor.page.getByText(/You're offline\. These are the notifications we last loaded/)).toBeVisible();
    const { text } = await publishRequest(browser, admin.page, city, s); // happens while the donor is offline
    await expect(donor.page.getByText(text)).toHaveCount(0);
    await donor.ctx.setOffline(false);
    await expect(donor.page.getByText(text)).toBeVisible({ timeout: 30_000 }); // catch-up refresh after reconnecting
    await expect(status(donor.page)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
    for (const u of [donor, admin]) await u.ctx.close();
  });
});

test.describe("optional email (local Mailpit only)", () => {
  test.skip(!MAIL, "MAILPIT_URL not set");
  test.setTimeout(120_000);

  test("opt-in settings, generic email delivered once, nothing sensitive inside", async ({ browser }) => {
    const s = stamp(), city = `Cm${s}`, email = uniq("mail");
    const donor = await newUser(browser, { email, name: `Mia ${s}`, city, group: "O+" }), admin = await newAdmin(browser);
    await donor.page.goto("/dashboard/donor/notifications");
    await expect(donor.page.getByLabel("Email me about new notifications")).not.toBeChecked(); // off by default
    await donor.page.getByLabel("Email me about new notifications").check();
    await donor.page.getByRole("button", { name: "Save settings" }).click();
    await expect(donor.page.getByText(/Email notifications are on/)).toBeVisible();
    const bulkEmail = uniq("bulk"), bulk = await newUser(browser, { email: bulkEmail, name: `Bo ${s}`, city: `Cb${s}`, group: "O+" });
    await queueBacklog(bulkEmail, 45); // 45 due rows, all OLDER than this test's own email: more than two worker batches
    const { hospital } = await publishRequest(browser, admin.page, city, s);
    execFileSync("node", ["scripts/email-worker.mjs", "--once"], { stdio: "pipe" }); // must drain the whole queue, not just 20 rows
    await waitForDelivery(email);
    expect((await outboxRows(bulkEmail)).filter((r) => r.status === "sent")).toHaveLength(45); // the backlog was drained in that same run
    await bulk.ctx.close();
    const msgs: { ID: string }[] = (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()).messages;
    const msg = await (await fetch(`${MAIL}/api/v1/message/${msgs[0].ID}`)).json();
    expect(msg.Subject).toBe("DonorConnect: you have a new notification");
    expect(`${msg.Text}${msg.HTML}`).toContain("/notifications");
    expect(`${msg.Text}${msg.HTML}`).not.toContain(hospital);
    execFileSync("node", ["scripts/email-worker.mjs", "--once"], { stdio: "pipe" });
    expect((await outboxRows(email)).map((r) => [r.status, r.attempts])).toEqual([["sent", 1]]); // not resent
    expect((await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()).messages).toHaveLength(1);
    await donor.page.getByLabel("Email me about new notifications").uncheck(); // turning it off is honoured
    await donor.page.getByRole("button", { name: "Save settings" }).click();
    await expect(donor.page.getByText(/Email notifications are off/)).toBeVisible();
    for (const u of [donor, admin]) await u.ctx.close();
  });
});

test.describe("rate limits (database-backed)", () => {
  test("repeated failed logins are blocked with a clear message; other accounts are unaffected", async ({ browser }) => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    const email = uniq("rl");
    const attempt = async () => {
      await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password", { exact: true }).fill("Wrong-pass1");
      await page.getByRole("button", { name: "Sign in" }).click();
    };
    for (let i = 0; i < 10; i++) { await attempt(); await expect(page.locator("form [role=alert]")).toContainText("Incorrect email or password"); }
    await attempt();
    await expect(page.locator("form [role=alert]")).toContainText(/Too many attempts\. Please try again in \d+ (seconds|minutes)\./);
    await ctx.close();
    const admin = await newAdmin(browser); // the seeded admin's successful logins never count against it
    await expect(admin.page).toHaveURL(/dashboard\/admin/);
    await admin.ctx.close();
  });

  test("password-reset requests are limited per email (no email bombing)", async ({ page }) => {
    const email = uniq("forgot");
    const ask = async () => { await page.goto("/forgot-password"); await page.getByLabel("Email").fill(email); await page.getByRole("button", { name: "Send reset link" }).click(); };
    for (let i = 0; i < 3; i++) { await ask(); await expect(page.getByRole("status")).toContainText("If an account exists"); }
    await ask();
    await expect(page.locator("form [role=alert]")).toContainText(/Too many attempts/);
  });

  test("registration attempts are limited per email", async ({ page }) => {
    const email = uniq("regrl");
    for (let i = 0; i < 5; i++) {
      await register(page, { email });
      await Promise.race([page.waitForURL(/dashboard/), page.locator("form [role=alert]").first().waitFor()]); // outcome, not network idle (the dashboard keeps a live socket open)
      await page.context().clearCookies(); // each attempt is a fresh visitor; the first creates the account, the rest are "already exists"
    }
    await register(page, { email });
    await expect(page.locator("form [role=alert]").first()).toContainText(/Too many attempts/);
  });
});

test.describe("privacy and security headers", () => {
  test("notification APIs require authentication and are never cacheable", async ({ request }) => {
    for (const path of ["/api/notifications", "/api/notifications/realtime"]) {
      const r = await request.get(path);
      expect(r.status()).toBe(401);
      expect(r.headers()["cache-control"]).toMatch(/no-store/);
    }
  });

  test("CSP and hardening headers are present; private routes are no-store; no CSP violations while using the app", async ({ browser }) => {
    const donor = await donorIn(browser, `Ch${stamp()}`, "csp");
    const problems: string[] = [];
    await donor.page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error("CSPVIOLATION " + e.violatedDirective + " " + e.blockedURI)));
    donor.page.on("console", (m) => { if (m.type() === "error" && /CSPVIOLATION|Content Security Policy/i.test(m.text())) problems.push(m.text()); });
    donor.page.on("pageerror", (e) => problems.push(e.message));
    for (const path of ["/dashboard/donor", "/dashboard/donor/opportunities", "/dashboard/donor/profile", "/dashboard/donor/notifications"]) {
      const r = await donor.page.goto(path); await donor.page.waitForTimeout(800);
      const h = r!.headers();
      expect(h["cache-control"]).toMatch(/no-store/);
      expect(h["content-security-policy"]).toMatch(/default-src 'self'/);
    }
    await expect(status(donor.page)).toHaveAttribute("data-state", /live|polling|connecting/); // the app works under the CSP, WebSocket included
    const pub = (await donor.page.request.get("/")).headers();
    const csp = pub["content-security-policy"];
    for (const d of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(d);
    expect(csp).not.toContain("'unsafe-eval'");           // production build
    expect(csp).toMatch(/connect-src 'self' http:\/\/127\.0\.0\.1:54321 ws:\/\/127\.0\.0\.1:54321/);
    expect(pub["x-frame-options"]).toBe("DENY");
    expect(pub["x-content-type-options"]).toBe("nosniff");
    expect(pub["cross-origin-opener-policy"]).toBe("same-origin");
    expect(pub["strict-transport-security"]).toContain("max-age");
    expect(problems).toEqual([]);
    await donor.ctx.close();
  });

  test("service worker caches only static build assets, never authenticated pages or data", async ({ browser }) => {
    const donor = await donorIn(browser, `Cs${stamp()}`, "sw"), page = donor.page;
    await page.goto("/dashboard/donor");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the worker
    for (const path of ["/dashboard/donor", "/dashboard/donor/opportunities", "/dashboard/donor/notifications", "/dashboard/donor/profile", "/dashboard/donor/offers"]) { await page.goto(path); await page.waitForTimeout(400); }
    await page.evaluate(async () => (await fetch("/api/notifications")).json());
    const urls = await page.evaluate(async () => { const out: string[] = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u === "/offline.html" || u.startsWith("/_next/static/") || u.startsWith("/icons/"))).toBe(true);
    expect(urls.some((u) => /dashboard|api|auth|notifications|login|register/.test(u))).toBe(false);
    expect(await page.evaluate(() => caches.keys())).toEqual(["dc-v2"]);
    await donor.ctx.close();
  });
});

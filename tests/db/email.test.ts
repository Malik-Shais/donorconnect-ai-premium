// @vitest-environment node
// Optional email delivery, tested through the REAL local Mailpit SMTP server + API (no real email is ever sent).
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { afterAll, describe, expect, it } from "vitest";
import { DB_URL, makeDonor, pool, root } from "./helpers";
import { buildMessage, isLocalSmtp, MAX_ATTEMPTS, processBatch } from "../../scripts/email-worker.mjs";

const MAIL = process.env.MAILPIT_URL;
if (!DB_URL || !MAIL) console.warn("\n⚠ TEST_DATABASE_URL / MAILPIT_URL not set: email tests SKIPPED (run `npm run db:up` first)\n");
const d = DB_URL && MAIL ? describe : describe.skip;
afterAll(() => pool.end());

const SITE = "http://localhost:3100";
const smtp = nodemailer.createTransport("smtp://127.0.0.1:54325");
const run = (transport: unknown = smtp, batch = 50) => processBatch({ pool, transport, siteUrl: SITE, batch }) as Promise<{ sent: number; skipped: number; retried: number; failed: number }>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const emailOf = async (id: string) => (await root<{ email: string }>("select email from auth.users where id=$1", [id]))[0].email;
const inbox = async (addr: string) => {
  await wait(300);
  const found = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${addr}`)}`)).json();
  return Promise.all((found.messages ?? []).map(async (m: { ID: string }) => (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()));
};
const optIn = (id: string, cats = "array['request','offer','invitation']") => root(`insert into public.notification_preferences (user_id, email_enabled, email_categories) values ($1, true, ${cats})`, [id]);
const notify = (id: string, key: string, msg = "x") => root("insert into public.notifications (user_id, message, dedupe_key) values ($1,$2,$3) returning id", [id, msg, key]);
const outbox = async (id: string) => (await root<{ status: string; attempts: number; last_error: string | null; next_attempt_at: Date }>("select status, attempts, last_error, next_attempt_at from public.email_outbox where user_id=$1 order by id", [id]));
// drain anything queued by other tests so counts below are exact
const drain = () => run(smtp, 500);

d("optional email via local Mailpit", () => {
  it("an opted-in user gets ONE generic email; sensitive notification text never leaves the app", async () => {
    await drain();
    const u = await makeDonor(); await optIn(u);
    await notify(u, `req:${randomUUID().slice(0, 6)}:e`, "HOSPITAL SECRET Patient X phone 0300 1234567 / reason: private");
    expect((await run()).sent).toBeGreaterThanOrEqual(1);
    const mails = await inbox(await emailOf(u));
    expect(mails).toHaveLength(1);
    const body = `${mails[0].Subject}\n${mails[0].Text}\n${mails[0].HTML}`;
    expect(mails[0].Subject).toBe("DonorConnect: you have a new notification");
    expect(body).toContain(`${SITE}/notifications`);
    expect(body).not.toMatch(/HOSPITAL SECRET|Patient X|0300 1234567|reason: private/); // the planted sensitive text
    expect((await run()).sent).toBe(0);                  // nothing left to send
    expect(await inbox(await emailOf(u))).toHaveLength(1); // no duplicate
    expect((await outbox(u))[0]).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("no email without opt-in, for unselected categories, or after opting out before delivery", async () => {
    await drain();
    const none = await makeDonor(), partial = await makeDonor(), quitter = await makeDonor();
    await notify(none, "req:1:n");
    await optIn(partial, "array['offer']"); await notify(partial, "req:1:p");   // request category not selected
    await optIn(quitter); await notify(quitter, "req:1:q");
    await root("update public.notification_preferences set email_enabled=false where user_id=$1", [quitter]); // opted out after queueing
    const r = await run();
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    for (const u of [none, partial, quitter]) expect(await inbox(await emailOf(u))).toHaveLength(0);
    expect((await outbox(quitter))[0].status).toBe("skipped");
    expect(await outbox(none)).toHaveLength(0);
  });

  it("failures retry with backoff, store only an error code, then dead-letter after the maximum attempts", async () => {
    await drain();
    const u = await makeDonor(); await optIn(u); await notify(u, "req:2:r");
    const addr = await emailOf(u);
    const broken = { sendMail: async () => { throw Object.assign(new Error(`connect ECONNREFUSED to ${addr}`), { code: "ECONNREFUSED" }); } };
    expect((await run(broken)).retried).toBe(1);
    let row = (await outbox(u))[0];
    expect(row).toMatchObject({ status: "pending", attempts: 1, last_error: "ECONNREFUSED" });
    expect(row.last_error).not.toContain("@");                      // never the recipient address
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now()); // backed off: not due yet
    expect((await run(smtp)).sent).toBe(0);                          // so an immediate working run does not send it
    for (let i = 2; i < MAX_ATTEMPTS; i++) { await root("update public.email_outbox set next_attempt_at=now() where user_id=$1", [u]); await run(broken); }
    await root("update public.email_outbox set next_attempt_at=now() where user_id=$1", [u]);
    expect((await run(broken)).failed).toBe(1);
    row = (await outbox(u))[0];
    expect(row).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    await root("update public.email_outbox set next_attempt_at=now() where user_id=$1", [u]);
    expect((await run(smtp)).sent).toBe(0);                          // dead letters are never retried
    expect(await inbox(addr)).toHaveLength(0);
  });

  it("a transient failure that later succeeds sends exactly once", async () => {
    await drain();
    const u = await makeDonor(); await optIn(u); await notify(u, "req:3:t");
    await run({ sendMail: async () => { throw Object.assign(new Error("x"), { code: "ETIMEDOUT" }); } });
    await root("update public.email_outbox set next_attempt_at=now() where user_id=$1", [u]);
    expect((await run(smtp)).sent).toBe(1);
    expect(await inbox(await emailOf(u))).toHaveLength(1);
    expect((await outbox(u))[0]).toMatchObject({ status: "sent", attempts: 2, last_error: null });
  });

  it("race: three workers draining one queue send every email exactly once", async () => {
    await drain();
    const users = await Promise.all(Array.from({ length: 6 }, () => makeDonor()));
    for (const u of users) { await optIn(u); await notify(u, `req:${randomUUID().slice(0, 6)}:c`); }
    const results = await Promise.all([run(smtp, 2), run(smtp, 2), run(smtp, 2)]);
    await run(smtp, 50); // sweep anything left after the small batches
    expect(results.reduce((n, r) => n + r.sent, 0)).toBeLessThanOrEqual(6);
    for (const u of users) expect(await inbox(await emailOf(u))).toHaveLength(1);
    for (const u of users) expect((await outbox(u))[0]).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("content builder and SMTP guard: generic text only, local hosts only", () => {
    const m = buildMessage({ to: "a@b.test", category: "invitation", siteUrl: "http://x.test/" });
    expect(m.text).toContain("a new invitation");
    expect(m.text).toContain("http://x.test/notifications");
    expect(isLocalSmtp("smtp://127.0.0.1:54325")).toBe(true);
    expect(isLocalSmtp("smtp://localhost:25")).toBe(true);
    expect(isLocalSmtp("smtp://smtp.example.com:587")).toBe(false);
    expect(isLocalSmtp("smtps://mail.sendgrid.net:465")).toBe(false);
  });
});

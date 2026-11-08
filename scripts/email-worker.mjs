// OPTIONAL, DEVELOPMENT-ONLY email worker. Drains public.email_outbox through an SMTP server.
//   npm run email:once     process the queue once        npm run email:worker   keep polling every 10 s
// Safety: refuses any non-local SMTP host (production SMTP is intentionally NOT configured; remote hosts need EMAIL_ALLOW_REMOTE=1,
// which must only be set after explicit approval). Content is generic: no patient, request, hospital or contact details, only a link to the app.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import pg from "pg";

const LABEL = { request: "an update about a blood request", offer: "an update about a donor offer", invitation: "a new invitation", review: "a request waiting for review", account: "an account update" };
export const MAX_ATTEMPTS = 5;

export const isLocalSmtp = (url) => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname);

export function buildMessage({ to, category, siteUrl, from = "DonorConnect <noreply@donorconnect.local>" }) {
  const what = LABEL[category] ?? "a new notification", link = `${siteUrl.replace(/\/$/, "")}/notifications`;
  return {
    from, to, subject: "DonorConnect: you have a new notification",
    text: `You have ${what} on DonorConnect AI.\n\nOpen your notifications: ${link}\n\nWe never put patient, request or contact details in emails.\nYou can turn email notifications off in Notification settings.`,
    html: `<p>You have ${what} on DonorConnect AI.</p><p><a href="${link}">Open your notifications</a></p><p style="color:#5b6b7e;font-size:12px">We never put patient, request or contact details in emails. You can turn email notifications off in Notification settings.</p>`,
  };
}

/** Claims due rows with FOR UPDATE SKIP LOCKED (safe with several workers), sends, and records the outcome in the same transaction.
 *  Delivery is at-least-once: a crash between SMTP acceptance and COMMIT could resend one email on the next run. */
export async function processBatch({ pool, transport, siteUrl, batch = 20 }) {
  const out = { sent: 0, skipped: 0, retried: 0, failed: 0 };
  const c = await pool.connect();
  try {
    await c.query("begin");
    const { rows } = await c.query(
      `select o.id, o.category, o.attempts, u.email, coalesce(p.email_enabled, false) as enabled
         from public.email_outbox o
         join auth.users u on u.id = o.user_id
         left join public.notification_preferences p on p.user_id = o.user_id
        where o.status = 'pending' and o.next_attempt_at <= now()
        order by o.id limit $1 for update of o skip locked`, [batch]);
    for (const r of rows) {
      if (!r.enabled || !r.email) { await c.query("update public.email_outbox set status='skipped' where id=$1", [r.id]); out.skipped++; continue; } // opted out since queueing
      try {
        await transport.sendMail(buildMessage({ to: r.email, category: r.category, siteUrl }));
        await c.query("update public.email_outbox set status='sent', sent_at=now(), attempts=attempts+1, last_error=null where id=$1", [r.id]);
        out.sent++;
      } catch (e) {
        const attempts = r.attempts + 1, dead = attempts >= MAX_ATTEMPTS;
        // Only an error CODE is stored, never the message (SMTP errors can echo the recipient address).
        await c.query("update public.email_outbox set attempts=$2, status=$3, last_error=$4, next_attempt_at = now() + make_interval(mins => $5) where id=$1",
          [r.id, attempts, dead ? "failed" : "pending", String(e?.code ?? "SEND_FAILED").slice(0, 40), 2 ** attempts]);
        if (dead) out.failed++; else out.retried++;
      }
    }
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  return out;
}

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const l of readFileSync(file, "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv(".env.worker");
  const { DATABASE_URL, EMAIL_SMTP_URL = "smtp://127.0.0.1:54325", SITE_URL = "http://localhost:3100" } = process.env;
  if (!DATABASE_URL) { console.error("DATABASE_URL missing (run `npm run db:up` to generate .env.worker)"); process.exit(1); }
  if (!isLocalSmtp(EMAIL_SMTP_URL) && process.env.EMAIL_ALLOW_REMOTE !== "1") {
    console.error("Refusing to send through a non-local SMTP server. Production SMTP is intentionally not configured."); process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const transport = nodemailer.createTransport(EMAIL_SMTP_URL);
  const run = async () => { const r = await processBatch({ pool, transport, siteUrl: SITE_URL }); if (r.sent + r.skipped + r.retried + r.failed) console.log(new Date().toISOString(), r); };
  if (process.argv.includes("--once")) { await run(); await pool.end(); }
  else { console.log("email worker running (local SMTP only)"); for (;;) { await run().catch((e) => console.error("batch failed:", e.code ?? e.message)); await new Promise((r) => setTimeout(r, 10_000)); } }
}

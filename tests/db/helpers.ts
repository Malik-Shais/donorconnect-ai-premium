// Real-PostgreSQL helpers. Tests impersonate users exactly as PostgREST does:
//   SET LOCAL ROLE authenticated|anon  +  request.jwt.claims  (read by auth.uid()).
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

export const DB_URL = process.env.TEST_DATABASE_URL;
export const pool = new Pool({ connectionString: DB_URL, max: 4 });

export type Q = <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]>;

/** Run fn as `userId` (authenticated) or anonymous (null) inside one transaction. Commits on success, rolls back on error. */
export async function as<T>(userId: string | null, fn: (q: Q) => Promise<T>, opts: { noLimiterSecret?: boolean } = {}): Promise<T> {
  const c: PoolClient = await pool.connect();
  const q: Q = async (sql, params) => (await c.query(sql, params)).rows;
  try {
    await c.query("begin");
    await c.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.headers', $3, true)", [
      JSON.stringify({ sub: userId, role: userId ? "authenticated" : "anon" }), userId ?? "",
      JSON.stringify(opts.noLimiterSecret || !process.env.RATE_LIMIT_SECRET ? {} : { "x-limiter-secret": process.env.RATE_LIMIT_SECRET }), // what the Next server sends
    ]);
    const out = await fn(q);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** Privileged query for arrange/cleanup steps only. */
export async function root<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await pool.query<T>(sql, params)).rows;
}

const run = randomUUID().slice(0, 8);
let n = 0;
/** Insert into auth.users like GoTrue would; the on_auth_user_created trigger builds the profile. */
export async function makeUser(meta: Record<string, unknown> = {}, label = "u"): Promise<string> {
  const id = randomUUID();
  await root(
    `insert into auth.users (id, aud, role, email, raw_user_meta_data, instance_id)
     values ($1, 'authenticated', 'authenticated', $2, $3, '00000000-0000-0000-0000-000000000000')`,
    [id, `${label}${++n}.${run}@test.example`, JSON.stringify({ full_name: "Test User", city: "Lahore", phone: "0300 1234567", blood_group: "O+", ...meta })],
  );
  return id;
}
export const makeAdmin = async () => { const id = await makeUser({}, "admin"); await root("update public.profiles set role='admin' where id=$1", [id]); return id; };
export const makeRequester = (meta = {}) => makeUser({ role: "requester", ...meta }, "req");
export const makeDonor = (blood_group = "O+", meta = {}) => makeUser({ role: "donor", blood_group, ...meta }, "don");
export async function makeRequest(requester: string, blood_group = "A+", city = "Lahore") {
  const [r] = await as(requester, (q) => q<{ id: string }>(
    `insert into public.blood_requests (requester_id, patient_label, blood_group, units, city, hospital, urgency)
     values ($1, 'Patient X', $2, 2, $3, 'Demo Hospital', 'urgent') returning id`, [requester, blood_group, city]));
  return r.id;
}

let sharedAdmin: Promise<string> | undefined;
/** One reusable admin per test run (admins are only ever created by privileged setup, never via sign-up). */
export const getAdmin = () => (sharedAdmin ??= makeAdmin());
export async function approve(requestId: string, method = "hospital_call") {
  const admin = await getAdmin();
  await as(admin, (q) => q("select public.review_request($1,'approve',null,$2)", [requestId, method]));
}
/** A request that has passed admin review (visible to donors). */
export async function makeApprovedRequest(requester: string, blood_group = "A+", city = "Lahore") {
  const id = await makeRequest(requester, blood_group, city);
  await approve(id);
  return id;
}

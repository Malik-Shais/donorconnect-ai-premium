// Stage 6 browser tests (real stack). Figures are checked against rows created here in a unique city, never against hard-coded numbers.
import { expect, test, type Browser } from "@playwright/test";
import { Client } from "pg";
import { adminApprove, newAdmin, newUser, stamp, submitRequest, uniq } from "./helpers";

const db = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => { const c = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await c.connect(); try { return (await c.query(sql, p)).rows as T[]; } finally { await c.end(); } };
const kpi = (p: import("@playwright/test").Page, id: string) => p.getByTestId(id);
test.skip(({ isMobile }) => isMobile, "widths and flows are exercised once, on the desktop project");

async function seeded(browser: Browser) {
  const city = `Anacity${stamp()}`, hospital = `Anahosp ${stamp()}`;
  const d1 = await newUser(browser, { email: uniq("and1"), role: "donor", city, group: "O+" }); const d2 = await newUser(browser, { email: uniq("and2"), role: "donor", city, group: "O+" });
  const rq = await newUser(browser, { email: uniq("anrq"), role: "requester", city });
  await submitRequest(rq.page, { hospital, city, group: "A+" });
  return { city, hospital, d1, d2, rq };
}

test.describe("analytics", () => {
  test("admin figures come from the database, update after approval, and tables/charts are accessible", async ({ browser }) => {
    const s = await seeded(browser); const admin = await newAdmin(browser), p = admin.page;
    await p.goto(`/dashboard/admin/reports?city=${s.city}`);
    await expect(p.getByRole("heading", { level: 1, name: "Analytics & reports" })).toBeVisible();
    await expect(kpi(p, "kpi-donors")).toContainText("2"); await expect(kpi(p, "kpi-requesters")).toContainText("1"); await expect(kpi(p, "kpi-available")).toContainText("2");
    await expect(p.getByTestId("empty-state")).toHaveCount(0);
    await expect(kpi(p, "rate-approval")).toContainText("—"); await expect(kpi(p, "rate-approval")).toContainText("No data");     // nothing reviewed yet: zero denominator, not 0%
    await expect(p.getByTestId("demo-banner")).toBeVisible();                                                                       // test accounts use .example addresses
    // accessibility: every chart has a text name and a real data table
    const charts = p.getByTestId("chart"); expect(await charts.count()).toBeGreaterThanOrEqual(9);
    const status = charts.filter({ hasText: "Requests by status" });
    await expect(status.getByRole("img")).toHaveAttribute("aria-label", /data table follows/);
    await expect(status.locator(".recharts-surface").first()).toBeVisible();
    await status.getByText("View as data table").click();
    await expect(status.getByRole("row", { name: /Pending review\s+1/ })).toBeVisible();
    // approve, reload: the rate is now computed from the new review
    await adminApprove(p, s.hospital); await p.goto(`/dashboard/admin/reports?city=${s.city}`);
    await expect(kpi(p, "rate-approval")).toContainText("100%"); await expect(kpi(p, "rate-approval")).toContainText("1 of 1");
    await expect(kpi(p, "rate-matching")).toContainText("0 of 1"); await expect(p.getByTestId("supply-table").getByRole("row", { name: /^A\+\s+1\s+1\s+2/ })).toBeVisible(); // 1 open request, 1 unit, 2 O+ donors
    for (const c of [s.d1, s.d2, s.rq, admin]) await c.ctx.close();
  });

  test("filters: blood group, city, invalid input, and empty results", async ({ browser }) => {
    const s = await seeded(browser); const admin = await newAdmin(browser), p = admin.page;
    await p.goto("/dashboard/admin/reports");
    await p.getByTestId("filters").getByLabel("City", { exact: true }).fill(s.city); await p.getByTestId("filters").getByLabel("Blood group", { exact: true }).selectOption("B+"); await p.getByRole("button", { name: "Apply" }).click();
    await expect(p).toHaveURL(/city=Anacity.*group=B%2B|group=B%2B.*city=Anacity/);
    await expect(p.getByTestId("empty-state")).toBeVisible();                                         // no B+ requests in that city
    await expect(p.getByTestId("chart").filter({ hasText: "Requests by status" })).toHaveAttribute("data-empty", "true");
    await expect(p.getByTestId("chart").filter({ hasText: "Requests by status" }).getByText("No data for this selection.")).toBeVisible();
    await p.getByTestId("filters").getByLabel("Blood group", { exact: true }).selectOption("A+"); await p.getByRole("button", { name: "Apply" }).click();
    await expect(p.getByTestId("empty-state")).toHaveCount(0);
    await expect(p.getByTestId("chart").filter({ hasText: "Requests by status" })).toHaveAttribute("data-empty", "false");
    await p.getByTestId("filters").getByLabel("Data scope", { exact: true }).selectOption("real"); await p.getByRole("button", { name: "Apply" }).click();   // test accounts are fictional
    await expect(p.getByTestId("empty-state")).toBeVisible(); await expect(kpi(p, "kpi-donors")).toContainText("0");
    await p.goto("/dashboard/admin/reports?from=2026-13-40&to=2026-01-01");                         // malformed: defaults + message, no crash, no SQL
    await expect(p.getByTestId("filter-error")).toContainText("valid date"); await expect(kpi(p, "kpi-donors")).toBeVisible();
    await p.goto("/dashboard/admin/reports?from=2026-05-01&to=2026-04-01");
    await expect(p.getByTestId("filter-error")).toContainText("start date");
    await p.goto("/dashboard/admin/reports?city=%27%3B%20drop%20table%20x--"); await expect(p.getByTestId("filter-error")).toContainText("unsupported");
    await p.getByRole("link", { name: "7 days" }).click(); await expect(p).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=/);
    for (const c of [s.d1, s.d2, s.rq, admin]) await c.ctx.close();
  });

  test("pagination of de-identified request rows", async ({ browser }) => {
    const city = `Anapage${stamp()}`, rq = await newUser(browser, { email: uniq("anpg"), role: "requester", city }), admin = await newAdmin(browser), p = admin.page;
    const [{ id }] = await db<{ id: string }>("select id from public.profiles where city = $1 and role = 'requester'", [city]);
    await db("insert into public.blood_requests (requester_id, patient_label, blood_group, units, city, hospital, urgency) select $1,'Patient X','A+',1,$2,'Rows Hospital','routine' from generate_series(1,27)", [id, city]);
    await p.goto(`/dashboard/admin/reports?city=${city}`);
    await expect(p.getByTestId("pager-info")).toContainText("Page 1 of 2"); await expect(p.getByTestId("pager-info")).toContainText("27 rows");
    await expect(p.getByTestId("history").getByRole("row")).toHaveCount(26);                          // header + 25
    await p.getByRole("link", { name: "Next" }).click(); await expect(p.getByTestId("pager-info")).toContainText("Page 2 of 2");
    await expect(p.getByTestId("history").getByRole("row")).toHaveCount(3);
    await expect(p.getByTestId("history")).not.toContainText("Rows Hospital"); await expect(p.getByTestId("history")).not.toContainText("Patient X");
    await rq.ctx.close(); await admin.ctx.close();
  });

  test("CSV exports: content, de-identification, formula injection, audit", async ({ browser }) => {
    const s = await seeded(browser); const admin = await newAdmin(browser), p = admin.page;
    await db("update public.blood_requests set city = $2 where hospital = $1", [s.hospital, "=cmd|' /C calc'!A0"]); // hostile value already in the data
    const adminId = (await db<{ id: string }>("select id from auth.users where email='admin@demo.example'"))[0].id;
    const before = Number((await db<{ n: string }>("select count(*) n from public.audit_logs where action='report.export' and actor_id=$1", [adminId]))[0].n);
    const res = await p.request.get("/api/reports/admin.requests?from=" + new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) + "&to=" + new Date().toISOString().slice(0, 10));
    expect(res.status()).toBe(200); expect(res.headers()["content-type"]).toContain("text/csv"); expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="donorconnect-admin-requests-\d{4}-\d{2}-\d{2}_/);
    expect(res.headers()["cache-control"]).toContain("no-store"); expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    const csv = await res.text();
    expect(csv.replace("﻿", "").split("\r\n")[0]).toBe("request_id,created_on,blood_group,city,urgency,units,status,hours_to_review,hours_to_first_accept,hours_approval_to_fulfilled,accepted_offers,fictional_demo_data");
    expect(csv).toContain("'=cmd|' /C calc'!A0");                                                  // neutralised with a leading apostrophe
    expect(csv).not.toMatch(/(^|,)[=+@]/m); expect(csv).not.toMatch(/(^|,)-[A-Za-z]/m);
    for (const secret of [s.hospital, "Patient", "@test.example", "Test Person"]) expect(csv).not.toContain(secret);
    const sum = await p.request.get("/api/reports/admin.summary?from=2026-01-01&to=2026-12-31&scope=all"); expect(sum.status()).toBe(200);
    expect(await sum.text()).toContain("approval_rate,"); expect(await (await p.request.get("/api/reports/admin.trend")).text()).toContain("bucket_start_utc,requests_created");
    expect(await (await p.request.get("/api/reports/admin.supply_demand")).text()).toContain("donors_per_unit");
    const after = Number((await db<{ n: string }>("select count(*) n from public.audit_logs where action='report.export' and actor_id=$1", [adminId]))[0].n);
    expect(after - before).toBe(4);                                                                  // every export is logged
    await p.goto("/dashboard/admin/reports"); await expect(p.getByTestId("exports").getByRole("link", { name: "Summary" })).toHaveAttribute("href", /\/api\/reports\/admin\.summary\?from=/);
    for (const c of [s.d1, s.d2, s.rq, admin]) await c.ctx.close();
  });

  test("authorization: roles are isolated on pages and exports", async ({ browser }) => {
    const donor = await newUser(browser, { email: uniq("anauthd"), role: "donor" }), rq = await newUser(browser, { email: uniq("anauthr"), role: "requester" });
    const anon = await browser.newContext(); const admin = await newAdmin(browser);
    expect((await anon.request.get("/api/reports/admin.summary")).status()).toBe(401);
    for (const k of ["admin.summary", "admin.requests", "requester.requests"]) expect((await donor.page.request.get(`/api/reports/${k}`)).status()).toBe(403);
    for (const k of ["admin.trend", "donor.offers"]) expect((await rq.page.request.get(`/api/reports/${k}`)).status()).toBe(403);
    for (const k of ["donor.offers", "requester.requests"]) expect((await admin.page.request.get(`/api/reports/${k}`)).status()).toBe(403);
    expect((await admin.page.request.get("/api/reports/nope")).status()).toBe(404); expect((await admin.page.request.get("/api/reports/__proto__")).status()).toBe(404);
    expect((await admin.page.request.get("/api/reports/admin.summary?from=2026-13-40&to=2026-01-01")).status()).toBe(400);
    expect((await admin.page.request.get("/api/reports/admin.summary?from=2026-01-01")).status()).toBe(400);   // both dates or neither
    expect((await admin.page.request.get("/api/reports/admin.summary?scope=bogus")).status()).toBe(400);
    expect((await donor.page.request.get("/api/reports/donor.offers?scope=demo")).status()).toBe(200);          // scope is ignored for non-admins, never widens access
    await donor.page.goto("/dashboard/admin/reports"); await expect(donor.page).toHaveURL(/\/dashboard\/donor$/);
    await rq.page.goto("/dashboard/donor/analytics"); await expect(rq.page).toHaveURL(/\/dashboard\/requester$/);
    await admin.page.goto("/dashboard/donor/analytics"); await expect(admin.page).toHaveURL(/\/dashboard\/admin$/);
    for (const c of [donor, rq, admin]) await c.ctx.close(); await anon.close();
  });

  test("donor analytics: own data only, empty and zero-denominator states", async ({ browser }) => {
    const donor = await newUser(browser, { email: uniq("andn"), role: "donor" }), p = donor.page;
    await p.goto("/dashboard/donor/analytics");
    await expect(p.getByRole("heading", { level: 1, name: "My activity" })).toBeVisible();
    await expect(p.getByTestId("empty-state")).toBeVisible(); await expect(kpi(p, "kpi-offers")).toContainText("0");
    await expect(kpi(p, "rate-reply")).toContainText("—"); await expect(kpi(p, "time-reply")).toContainText("No data yet");
    await expect(p.getByTestId("rows-empty")).toBeVisible();
    for (const t of ["Platform", "donors_total", "Registered donors", "Fictional"]) await expect(p.locator("main")).not.toContainText(t);   // no admin aggregates leak into donor pages
    await expect(p.getByTestId("exports").getByRole("link")).toHaveCount(1);
    expect((await p.request.get("/api/reports/donor.offers")).status()).toBe(200);
    await donor.ctx.close();
  });

  test("requester analytics: own requests only", async ({ browser }) => {
    const a = await newUser(browser, { email: uniq("anra"), role: "requester" }), b = await newUser(browser, { email: uniq("anrb"), role: "requester" });
    await submitRequest(a.page, { hospital: `Anaown ${stamp()}`, city: "Lahore", group: "B+" });
    await a.page.goto("/dashboard/requester/analytics");
    await expect(kpi(a.page, "kpi-requests")).toContainText("1"); await expect(kpi(a.page, "kpi-active")).toContainText("1");
    await expect(a.page.getByTestId("history").getByRole("row")).toHaveCount(2); await expect(a.page.getByTestId("history")).not.toContainText("Anaown");   // hospital is never in analytics rows
    await expect(kpi(a.page, "rate-approval")).toContainText("—");
    await b.page.goto("/dashboard/requester/analytics");
    await expect(kpi(b.page, "kpi-requests")).toContainText("0"); await expect(b.page.getByTestId("empty-state")).toBeVisible(); await expect(b.page.getByTestId("history")).toHaveCount(0);
    expect(await (await b.page.request.get("/api/reports/requester.requests")).text()).not.toMatch(/\r\n\d+,/);   // header only: none of a's rows
    await a.ctx.close(); await b.ctx.close();
  });
});

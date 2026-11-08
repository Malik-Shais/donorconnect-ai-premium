// REAL end-to-end journeys through browser -> Next.js -> GoTrue -> PostgreSQL (RLS + workflow functions).
// Requires `npm run db:up && npm run db:seed`. Each person gets their own browser context (cookie jar).
import { expect, test } from "@playwright/test";
import { adminApprove, login, newAdmin, newUser, stamp, submitRequest, uniq } from "./helpers";

const donorOpts = (city: string, name: string) => ({ email: uniq("dn"), name, city, group: "O+", phone: "+92 300 7654321" });

test("full journey: requester -> admin review -> donor offer -> contact consent -> revoke -> completion", async ({ browser }) => {
  const s = stamp(), city = `Cj${s}`, hospital = `Journey Hospital ${s}`, donorName = `Dana Journey ${s}`;
  const requester = await newUser(browser, { email: uniq("rq"), role: "requester", name: `Rita Journey ${s}`, city });
  const donor = await newUser(browser, donorOpts(city, donorName));
  const admin = await newAdmin(browser);

  // 1. Requester submits through the 3-step wizard -> pending review
  await submitRequest(requester.page, { hospital, city });
  await expect(requester.page.getByText("Request submitted.")).toBeVisible();
  await expect(requester.page.getByText("Pending review", { exact: true }).first()).toBeVisible();
  await expect(requester.page.getByText("Donors are not notified until it is approved")).toBeVisible();
  await expect(requester.page.getByRole("list", { name: "Request activity" }).getByText("Submitted for review").first()).toBeVisible();
  const requestUrl = requester.page.url().split("?")[0];

  // 2. Donor sees NOTHING yet: not in opportunities, no notification
  await donor.page.goto("/dashboard/donor/opportunities");
  await expect(donor.page.getByText(hospital)).toHaveCount(0);
  await donor.page.goto("/dashboard/donor/notifications");
  await expect(donor.page.getByText(/request in/)).toHaveCount(0);

  // 3. Admin verifies and approves (incomplete verification is refused inside adminApprove)
  await adminApprove(admin.page, hospital);

  // 4. Donor is notified, sees it (preliminary, no patient label), filters, accepts WITH consent
  await donor.page.goto("/dashboard/donor/notifications");
  await expect(donor.page.getByText(`Urgent A+ request in ${city}`)).toBeVisible();
  await donor.page.goto(`/dashboard/donor/opportunities?city=${city}&group=A%2B`);
  await expect(donor.page.getByText(/Matching is preliminary/)).toBeVisible();
  const card = donor.page.locator("li", { has: donor.page.locator("form") }).filter({ hasText: hospital });
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("Pat X."); // patient label never reaches donors
  await card.getByLabel(/Share my name, phone/).check();
  await card.getByRole("button", { name: "I can help" }).click();
  await expect(donor.page.getByText("You accepted this request")).toBeVisible();
  await donor.page.goto("/dashboard/donor/offers");
  await expect(donor.page.getByText("Contact sharing: ON")).toBeVisible();

  // 5. Requester: matched, sees the donor's consented contact + the disclosure notice
  await requester.page.goto(requestUrl);
  await expect(requester.page.getByText("Matched", { exact: true }).first()).toBeVisible();
  await expect(requester.page.getByText(donorName)).toBeVisible();
  await expect(requester.page.getByRole("link", { name: "+92 300 7654321" })).toBeVisible();
  await expect(requester.page.getByText(/cannot be recalled/)).toBeVisible();
  await requester.page.goto("/dashboard/requester/notifications");
  await expect(requester.page.getByText(/A donor accepted your A\+ request and shared contact details/)).toBeVisible();

  // 6. Donor revokes consent -> requester loses access to future views
  await donor.page.getByRole("button", { name: "Stop sharing my contact details" }).click();
  await expect(donor.page.getByText("Contact sharing: OFF")).toBeVisible();
  await expect(donor.page.getByText(/cannot be recalled/)).toBeVisible(); // the honest notice about already-seen data
  await requester.page.goto(requestUrl);
  await expect(requester.page.getByText("Anonymous donor")).toBeVisible();
  await expect(requester.page.getByText(donorName)).toHaveCount(0);
  await expect(requester.page.getByText("+92 300 7654321")).toHaveCount(0);

  // 7. Donor shares again; requester completes the request; contact disappears when closed
  await donor.page.getByRole("button", { name: "Share my contact details" }).click();
  await expect(donor.page.getByText("Contact sharing: ON")).toBeVisible();
  await requester.page.goto(requestUrl);
  await expect(requester.page.getByRole("link", { name: "+92 300 7654321" })).toBeVisible();
  await requester.page.getByRole("button", { name: "Mark fulfilled" }).click();
  await requester.page.getByRole("dialog").getByRole("button", { name: "Mark fulfilled" }).click();
  await expect(requester.page.getByText("Fulfilled", { exact: true }).first()).toBeVisible();
  await expect(requester.page.getByText("No further actions")).toBeVisible();
  await expect(requester.page.getByText("+92 300 7654321")).toHaveCount(0);
  await expect(requester.page.getByText("Marked fulfilled")).toBeVisible(); // timeline

  // 8. Admin sees complete history + audit trail, and NEVER the contact details
  const detail = requestUrl.replace("/requester/", "/admin/");
  await admin.page.goto(detail);
  for (const action of ["request.submit", "request.review", "request.transition", "contact.disclosed"]) await expect(admin.page.getByText(action).first()).toBeVisible();
  await expect(admin.page.getByText("+92 300 7654321")).toHaveCount(0);
  await expect(admin.page.getByText(donorName)).toHaveCount(0);
  for (const u of [requester, donor, admin]) await u.ctx.close();
});

test("rejection: reason is required, shown to the requester, and donors never hear about it", async ({ browser }) => {
  const s = stamp(), city = `Cr${s}`, hospital = `Reject Hospital ${s}`;
  const requester = await newUser(browser, { email: uniq("rq"), role: "requester", city });
  const donor = await newUser(browser, donorOpts(city, `Dan Reject ${s}`));
  const admin = await newAdmin(browser);
  await submitRequest(requester.page, { hospital, city });
  const requestUrl = requester.page.url().split("?")[0];

  await admin.page.goto("/dashboard/admin/review");
  const card = admin.page.locator("li", { hasText: hospital });
  await card.getByRole("button", { name: "Reject…" }).click();
  const dialog = admin.page.getByRole("dialog", { name: "Reject this request?" });
  await dialog.getByRole("button", { name: "Reject request" }).click(); // reason is a required field
  await dialog.getByLabel(/Reason shown to the requester/).fill("Could not verify the hospital");
  await dialog.getByRole("button", { name: "Reject request" }).click();
  await expect(dialog).toBeHidden();

  await requester.page.goto(requestUrl);
  await expect(requester.page.getByText("Rejected", { exact: true }).first()).toBeVisible();
  await expect(requester.page.getByText("Could not verify the hospital").first()).toBeVisible();
  await expect(requester.page.getByRole("button", { name: "Cancel request" })).toHaveCount(0); // terminal

  await donor.page.goto("/dashboard/donor/opportunities");
  await expect(donor.page.getByText(hospital)).toHaveCount(0);
  await donor.page.goto("/dashboard/donor/notifications");
  await expect(donor.page.getByText(/request in/)).toHaveCount(0);
  for (const u of [requester, donor, admin]) await u.ctx.close();
});

test("cancellation: requester cancels a pending request and it leaves the admin queue; admin moderation cancels an approved one", async ({ browser }) => {
  const s = stamp(), city = `Cc${s}`;
  const requester = await newUser(browser, { email: uniq("rq"), role: "requester", city });
  const admin = await newAdmin(browser);
  const h1 = `Cancel Hospital ${s}`, h2 = `Moderate Hospital ${s}`;
  await submitRequest(requester.page, { hospital: h1, city });
  await requester.page.getByRole("button", { name: "Cancel request" }).click();
  await requester.page.getByRole("dialog").getByRole("button", { name: "Cancel request" }).click();
  await expect(requester.page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await admin.page.goto("/dashboard/admin/review");
  await expect(admin.page.getByText(h1)).toHaveCount(0);

  await submitRequest(requester.page, { hospital: h2, city });
  const url2 = requester.page.url().split("?")[0];
  await adminApprove(admin.page, h2);
  await admin.page.goto(url2.replace("/requester/", "/admin/"));
  await admin.page.getByRole("button", { name: "Cancel (moderation)" }).click();
  const dialog = admin.page.getByRole("dialog", { name: "Cancel this request?" });
  await dialog.getByRole("button", { name: "Cancel request" }).click(); // note required
  await dialog.getByLabel(/Moderation note/).fill("Duplicate of another request");
  await dialog.getByRole("button", { name: "Cancel request" }).click();
  await expect(dialog).toBeHidden();
  await requester.page.goto(url2);
  await expect(requester.page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(requester.page.getByText("Duplicate of another request")).toBeVisible();
  await requester.page.goto("/dashboard/requester/notifications");
  await expect(requester.page.getByText(/administrator cancelled your request/)).toBeVisible();
  for (const u of [requester, admin]) await u.ctx.close();
});

test("invitations: requester invites anonymously, donor declines/accepts from My offers", async ({ browser }) => {
  const s = stamp(), city = `Ci${s}`, hospital = `Invite Hospital ${s}`;
  const requester = await newUser(browser, { email: uniq("rq"), role: "requester", city });
  const donor = await newUser(browser, donorOpts(city, `Ivy Invite ${s}`));
  const admin = await newAdmin(browser);
  await submitRequest(requester.page, { hospital, city });
  const url = requester.page.url().split("?")[0];
  await adminApprove(admin.page, hospital);
  await requester.page.goto(url);
  await requester.page.getByRole("button", { name: "Invite matching donors" }).click();
  await expect(requester.page.getByText(/Invited \d+ preliminary match/)).toBeVisible();
  await requester.page.reload();
  await expect(requester.page.getByText("Anonymous donor").first()).toBeVisible(); // identity stays private
  await expect(requester.page.getByText(`Ivy Invite ${s}`)).toHaveCount(0);

  await donor.page.goto("/dashboard/donor/offers");
  // Invitations rank same-city donors first, then fill with other compatible donors, so other tests' requests may also invite this donor.
  const invitation = donor.page.locator("li", { hasText: hospital });
  await expect(invitation).toBeVisible();
  await invitation.getByRole("button", { name: "Accept invitation" }).click();
  await expect(donor.page.getByRole("heading", { name: /Accepted offers \(1\)/ })).toBeVisible();
  await expect(donor.page.getByText("Contact sharing: OFF")).toBeVisible(); // consent was not given
  await donor.page.getByRole("button", { name: "Withdraw offer" }).click();
  await donor.page.getByRole("dialog").getByRole("button", { name: "Withdraw offer" }).click();
  await expect(donor.page.getByRole("heading", { name: /Accepted offers \(0\)/ })).toBeVisible();
  await requester.page.goto(url);
  await expect(requester.page.getByText("Approved", { exact: true }).first()).toBeVisible(); // reopened to donors
  for (const u of [requester, donor, admin]) await u.ctx.close();
});

test.describe("unauthorized access", () => {
  test("role areas, other users' requests and admin pages are closed to everyone else", async ({ browser, page }) => {
    const s = stamp(), city = `Cu${s}`, hospital = `Private Hospital ${s}`;
    const owner = await newUser(browser, { email: uniq("rq"), role: "requester", city });
    const other = await newUser(browser, { email: uniq("rq2"), role: "requester", city });
    const donor = await newUser(browser, donorOpts(city, `Dee Unauth ${s}`));
    await submitRequest(owner.page, { hospital, city });
    const url = owner.page.url().split("?")[0], id = url.split("/").pop()!;

    // another requester: the request does not exist for them
    await other.page.goto(url); // (Next streams the not-found UI with status 200 under loading.tsx, so assert on content)
    await expect(other.page.getByText("This page could not be found")).toBeVisible();
    await expect(other.page.getByText(hospital)).toHaveCount(0);
    // donor: bounced from requester and admin areas
    for (const path of [`/dashboard/requester/requests/${id}`, "/dashboard/admin/review", `/dashboard/admin/requests/${id}`, "/dashboard/admin/donors", "/dashboard/admin/users"]) {
      await donor.page.goto(path);
      await expect(donor.page).toHaveURL(/\/dashboard\/donor$/);
    }
    // requester: cannot reach admin pages either
    for (const path of ["/dashboard/admin/review", "/dashboard/admin/donors", `/dashboard/admin/requests/${id}`]) {
      await owner.page.goto(path);
      await expect(owner.page).toHaveURL(/\/dashboard\/requester$/);
    }
    // signed-out visitor
    for (const path of [url, `/dashboard/admin/requests/${id}`]) { await page.goto(path); await expect(page).toHaveURL(/\/login/); }
    for (const u of [owner, other, donor]) await u.ctx.close();
  });

  test("a donor cannot call privileged server functions directly (database enforces it)", async ({ browser }) => {
    const donor = await newUser(browser, donorOpts(`Cd${stamp()}`, "Dex Direct"));
    // the browser has no Supabase client; try the REST gateway with the donor's own session cookie value anyway
    const chunks = (await donor.ctx.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name)); // the session cookie may be chunked
    const json = JSON.parse(Buffer.from(decodeURIComponent(chunks.map((c) => c.value).join("")).replace(/^base64-/, ""), "base64url").toString());
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const call = (fn: string, body: object) => fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${json.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await (await call("review_request", { p_id: 1, p_decision: "approve", p_method: "other" })).json()).message).toMatch(/Administrators only/);
    expect((await (await call("set_user_suspended", { p_user: crypto.randomUUID(), p_suspended: true, p_reason: "Because I want" })).json()).message).toMatch(/Administrators only/);
    const escalate = await fetch(`${base}/rest/v1/profiles?id=eq.${json.user.id}`, { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${json.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
    expect(escalate.status).toBe(403);
    await donor.ctx.close();
  });
});

test.describe("administration", () => {
  test("eligibility is recorded from a named blood service and pauses matching; suspension locks an account out and restore reopens it", async ({ browser }) => {
    const s = stamp(), city = `Ce${s}`, name = `Eli Eligible ${s}`;
    const donor = await newUser(browser, { ...donorOpts(city, name) });
    const admin = await newAdmin(browser);

    await admin.page.goto(`/dashboard/admin/donors?q=${encodeURIComponent(name)}`);
    await expect(admin.page.getByText(/App administrators cannot medically clear a donor/)).toBeVisible();
    const row = admin.page.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("button", { name: "Record decision…" }).click();
    const dialog = admin.page.getByRole("dialog", { name: /Record a blood-service decision/ });
    await dialog.getByLabel("Decision recorded").selectOption("deferred");
    await dialog.getByRole("button", { name: "Record decision" }).click(); // source + attestation are required
    await expect(dialog.getByText(/authorised blood service/).first()).toBeVisible();
    await dialog.getByLabel(/Source/).fill("City Blood Bank ref 42");
    await dialog.getByLabel(/This decision came from an authorised blood service/).check();
    await dialog.getByRole("button", { name: "Record decision" }).click();
    await expect(dialog).toBeHidden();
    await expect(admin.page.getByRole("row", { name: new RegExp(name) }).getByText("deferred")).toBeVisible();
    await expect(admin.page.getByRole("row", { name: new RegExp(name) }).getByText(/City Blood Bank ref 42/)).toBeVisible();

    await donor.page.goto("/dashboard/donor/opportunities");
    await expect(donor.page.getByText(/blood service decision has put your eligibility on hold/)).toBeVisible();
    await donor.page.goto("/dashboard/donor");
    await expect(donor.page.getByText("On hold")).toBeVisible();
    await donor.page.goto("/dashboard/donor/notifications");
    await expect(donor.page.getByText(/blood service decision about your donor eligibility was recorded/)).toBeVisible();

    // suspension
    await admin.page.goto(`/dashboard/admin/users?q=${encodeURIComponent(name)}`);
    await admin.page.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Suspend…" }).click();
    const sd = admin.page.getByRole("dialog", { name: /Suspend/ });
    await sd.getByLabel(/Reason/).fill("Repeated policy violations");
    await sd.getByRole("button", { name: "Suspend account" }).click();
    await expect(sd).toBeHidden();
    await donor.page.goto("/dashboard/donor");
    await expect(donor.page).toHaveURL(/\/suspended/);
    await expect(donor.page.getByRole("heading", { name: "Account suspended" })).toBeVisible();
    await admin.page.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Restore" }).click();
    await expect(admin.page.getByRole("row", { name: new RegExp(name) }).getByText("suspended")).toHaveCount(0);
    await donor.page.goto("/dashboard/donor");
    await expect(donor.page).toHaveURL(/\/dashboard\/donor$/);
    for (const u of [donor, admin]) await u.ctx.close();
  });

  test("administrators cannot be suspended, and wrong admin passwords are rejected", async ({ browser }) => {
    const admin = await newAdmin(browser);
    await admin.page.goto("/dashboard/admin/users?q=Demo%20Admin");
    await expect(admin.page.getByRole("row", { name: /Demo Admin/ })).toBeVisible();
    await expect(admin.page.getByRole("row", { name: /Demo Admin/ }).getByRole("button")).toHaveCount(0);
    await admin.ctx.close();
    const ctx = await browser.newContext(); const p = await ctx.newPage();
    await login(p, "admin@demo.example", "wrong-password"); await expect(p.locator("form [role=alert]")).toContainText("Incorrect email or password");
    await ctx.close();
  });
});

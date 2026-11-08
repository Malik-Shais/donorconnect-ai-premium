// REAL end-to-end tests: browser -> Next.js -> GoTrue (Auth) -> PostgreSQL/RLS. Requires `npm run db:up && npm run db:seed`.
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "Passw0rd!x";
const uniq = (tag: string) => `e2e.${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@test.example`;

async function register(page: Page, o: { email: string; name?: string; role?: "donor" | "requester"; group?: string; city?: string }) {
  await page.goto(`/register?role=${o.role ?? "donor"}`);
  await page.getByLabel("Full name").fill(o.name ?? "Test Person");
  await page.getByLabel("Email").fill(o.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("City").fill(o.city ?? "Lahore");
  if ((o.role ?? "donor") === "donor") await page.getByLabel("Blood group").selectOption(o.group ?? "O+");
  await page.getByLabel(/I am 18 or older/).check();
  await page.getByRole("button", { name: "Create account" }).click();
}
const login = async (page: Page, email: string, password = PASSWORD) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};
const signOut = async (page: Page) => { await page.getByRole("button", { name: "Sign out" }).click(); await page.waitForURL("/"); };
async function newUser(browser: Browser, o: Parameters<typeof register>[1]) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await register(page, o); await page.waitForURL(/\/dashboard\//);
  return { ctx, page };
}

test.describe("route protection", () => {
  test("unauthenticated visitors are sent to sign-in for every protected route", async ({ page }) => {
    for (const p of ["/dashboard", "/dashboard/donor", "/dashboard/admin", "/dashboard/requester/new-request", "/dashboard/admin/users"]) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/login/);
    }
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/forgot-password/);
  });
  test("a forged session cookie grants nothing", async ({ context, page }) => {
    await context.addCookies([{ name: "sb-127-auth-token", value: "base64-eyJhY2Nlc3NfdG9rZW4iOiJmb3JnZWQifQ", url: "http://localhost:3100" }]);
    await page.goto("/dashboard/admin");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("registration, login, session, logout", () => {
  test("register -> dashboard with real data -> persists across reload -> logout -> login", async ({ page, context }) => {
    const email = uniq("flow");
    await register(page, { email, name: "Ayesha Tester", group: "A-" });
    await expect(page).toHaveURL(/\/dashboard\/donor/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello, Ayesha");
    await expect(page.getByText("A-", { exact: true }).first()).toBeVisible();

    await page.reload(); // session persistence
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello, Ayesha");
    const second = await context.newPage(); await second.goto("/dashboard");
    await expect(second).toHaveURL(/\/dashboard\/donor/);

    await signOut(page);
    await expect(page).toHaveURL("/");
    await page.goto("/dashboard/donor");
    await expect(page).toHaveURL(/\/login/);

    await login(page, email);
    await expect(page).toHaveURL(/\/dashboard\/donor/);
  });
  test("login shows friendly errors and a signed-in user is redirected away from /login", async ({ page }) => {
    const email = uniq("login");
    await register(page, { email }); await page.waitForURL(/dashboard/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard\/donor/);
    await signOut(page);
    await login(page, email, "WrongPass1");
    await expect(page.locator("form [role=alert]")).toContainText("Incorrect email or password");
    await login(page, "nobody@test.example");
    await expect(page.locator("form [role=alert]")).toContainText("Incorrect email or password"); // same message: no account enumeration
  });
  test("registration validates input and rejects duplicate emails", async ({ page, browser }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByText("Please confirm you are 18+")).toBeVisible();
    const email = uniq("dup");
    const { ctx } = await newUser(browser, { email });
    await register(page, { email });
    await expect(page.locator("form [role=alert]").first()).toContainText("already exists");
    await ctx.close();
  });
  test("login honours a safe ?next= and ignores open-redirect attempts", async ({ page }) => {
    const email = uniq("next");
    await register(page, { email }); await page.waitForURL(/dashboard/); await signOut(page);
    await page.goto("/login?next=//evil.example"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/localhost:3100\/dashboard\/donor/);
    await signOut(page);
    await page.goto("/dashboard/donor/profile"); await expect(page).toHaveURL(/login\?next=/);
    await page.getByLabel("Email").fill(email); await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard\/donor\/profile/);
  });
});

test.describe("authorization", () => {
  test("users cannot reach other roles' areas by URL, and cannot register as admin", async ({ browser, page }) => {
    const { ctx, page: donor } = await newUser(browser, { email: uniq("authz") });
    for (const p of ["/dashboard/admin", "/dashboard/admin/users", "/dashboard/requester", "/dashboard/requester/new-request"]) {
      await donor.goto(p);
      await expect(donor).toHaveURL(/\/dashboard\/donor$/);
    }
    await ctx.close();
    // Tamper with the signup form: the server must refuse an 'admin' role.
    await page.goto("/register");
    await page.getByLabel("I want to").evaluate((el: HTMLSelectElement) => { el.add(new Option("admin", "admin")); el.value = "admin"; });
    await page.getByLabel("Full name").fill("Mallory"); await page.getByLabel("Email").fill(uniq("evil"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD); await page.getByLabel("City").fill("Lahore");
    await page.getByLabel(/I am 18 or older/).check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Choose a valid account type")).toBeVisible();
    await expect(page).toHaveURL(/register/);
  });
  test("admin area works for the seeded admin only", async ({ page }) => {
    await login(page, "admin@demo.example", "Demo@12345");
    await expect(page).toHaveURL(/\/dashboard\/admin$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Analytics");
    await page.goto("/dashboard/admin/users");
    await expect(page.getByRole("cell", { name: "Ayesha Khan" })).toBeVisible();
    await page.goto("/dashboard/donor"); // admin is not a donor
    await expect(page).toHaveURL(/\/dashboard\/admin$/);
  });
});

test.describe("profile", () => {
  test("profile and availability updates persist in the database", async ({ browser }) => {
    const { ctx, page } = await newUser(browser, { email: uniq("prof"), city: "Lahore" });
    await page.goto("/dashboard/donor/profile");
    await page.getByLabel("City").fill("Karachi");
    await page.getByLabel("Phone").fill("+92 300 1112233");
    await page.getByLabel("Blood group").selectOption("B+");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText("Profile saved");
    await page.reload();
    await expect(page.getByLabel("City")).toHaveValue("Karachi");
    await expect(page.getByLabel("Phone")).toHaveValue("+92 300 1112233");
    await expect(page.getByLabel("Blood group")).toHaveValue("B+");

    await page.getByLabel("Phone").fill("not a phone");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter a valid phone number")).toBeVisible();

    await page.goto("/dashboard/donor");
    const toggle = page.getByRole("switch");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toBeEnabled(); // the save has finished (button is disabled while pending)
    await page.reload();
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await ctx.close();
  });
});

test.describe("requests across users", () => {
  test("requester creates/cancels; other requester cannot see it; compatible donor sees and accepts it", async ({ browser }) => {
    const hospital = `E2E Hospital ${Date.now()}`; // unique per run: the database persists between runs
    const r1 = await newUser(browser, { email: uniq("r1"), role: "requester", name: "Rita Requester" });
    const r2 = await newUser(browser, { email: uniq("r2"), role: "requester", name: "Omar Other" });
    const donor = await newUser(browser, { email: uniq("dn"), group: "O-", name: "Dina Donor" });

    await r1.page.goto("/dashboard/requester/new-request");
    await r1.page.getByRole("button", { name: "Post request" }).click();
    await expect(r1.page.getByText("Patient alias must be at least 2 characters")).toBeVisible();
    await r1.page.getByLabel("Patient alias / initials").fill("Pat X.");
    await r1.page.getByLabel("Blood group needed").selectOption("A+");
    await r1.page.getByLabel("Hospital / blood bank").fill(hospital);
    await r1.page.getByRole("button", { name: "Post request" }).click();
    await expect(r1.page).toHaveURL(/\/dashboard\/requester\/requests/);
    await expect(r1.page.getByText(hospital)).toBeVisible();

    await r2.page.goto("/dashboard/requester/requests"); // cross-user: must not see r1's request
    await expect(r2.page.getByText(hospital)).toHaveCount(0);
    await expect(r2.page.getByText("No requests yet")).toBeVisible();

    await donor.page.goto("/dashboard/donor/opportunities"); // O- can give to A+
    const card = donor.page.locator("li", { has: donor.page.locator("form") }).filter({ hasText: hospital });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("Pat X."); // requester-provided patient label is not exposed to donors
    await card.getByRole("button", { name: "I can help" }).click();
    await expect(donor.page.getByText("You accepted this request")).toHaveCount(1);

    await r1.page.goto("/dashboard/requester/notifications");
    await expect(r1.page.getByText(/A donor accepted your A\+ request\./)).toBeVisible();
    await r1.page.goto("/dashboard/requester/requests");
    await expect(r1.page.getByText("matched", { exact: true })).toBeVisible();
    await r1.page.getByRole("button", { name: "Cancel" }).click();
    await expect(r1.page.getByText("cancelled", { exact: true })).toBeVisible();
    for (const u of [r1, r2, donor]) await u.ctx.close();
  });
});

test.describe("password recovery (real email via local Mailpit)", () => {
  test("request link -> email -> set new password -> old password rejected", async ({ page }) => {
    const mail = process.env.MAILPIT_URL;
    test.skip(!mail, "MAILPIT_URL not set");
    const email = uniq("reset");
    await register(page, { email }); await page.waitForURL(/dashboard/); await signOut(page);

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");

    let link = "";
    await expect.poll(async () => {
      const found = await (await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
      if (!found.messages?.length) return "";
      const msg = await (await fetch(`${mail}/api/v1/message/${found.messages[0].ID}`)).json();
      link = /https?:\/\/[^\s"'<>]+\/verify\?[^\s"'<>]+/.exec(`${msg.Text}${msg.HTML}`)?.[0].replace(/&amp;/g, "&") ?? "";
      return link;
    }, { timeout: 20_000 }).not.toBe("");

    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password/);
    await page.getByLabel("New password", { exact: true }).fill("NewPassw0rd!");
    await page.getByLabel("Confirm new password").fill("Different1!");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Passwords do not match")).toBeVisible();
    // Passwords are never echoed back after a validation error, so both fields must be re-entered.
    await page.getByLabel("New password", { exact: true }).fill("NewPassw0rd!");
    await page.getByLabel("Confirm new password").fill("NewPassw0rd!");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page).toHaveURL(/\/dashboard\/donor/);

    await signOut(page);
    await login(page, email, PASSWORD);
    await expect(page.locator("form [role=alert]")).toContainText("Incorrect email or password");
    await login(page, email, "NewPassw0rd!");
    await expect(page).toHaveURL(/\/dashboard\/donor/);
  });
  test("an unknown email gets the same generic response (no account enumeration)", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("ghost@test.example");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");
  });
});

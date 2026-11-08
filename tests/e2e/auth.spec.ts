// REAL end-to-end tests: browser -> Next.js -> GoTrue (Auth) -> PostgreSQL/RLS. Requires `npm run db:up && npm run db:seed`.
import { expect, test } from "@playwright/test";

import { login, newUser, PASSWORD, register, signOut, uniq } from "./helpers";

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
    await page.goto("/dashboard/admin/users?q=Ayesha"); // the list shows the newest 100; search finds anyone
    await expect(page.getByRole("cell", { name: "Ayesha Khan" })).toBeVisible();
    await page.goto("/dashboard/donor"); // admin is not a donor
    await expect(page).toHaveURL(/\/dashboard\/admin$/);
  });
});

test.describe("profile", () => {
  test("profile and availability updates persist in the database", async ({ browser }) => {
    const { ctx, page } = await newUser(browser, { email: uniq("prof"), city: "Lahore" });
    await page.goto("/dashboard/donor/profile");
    await page.getByLabel("City", { exact: true }).fill("Karachi");
    await page.getByLabel("Phone").fill("+92 300 1112233");
    await page.getByLabel("Blood group").selectOption("B+");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText("Profile saved");
    await page.reload();
    await expect(page.getByLabel("City", { exact: true })).toHaveValue("Karachi");
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

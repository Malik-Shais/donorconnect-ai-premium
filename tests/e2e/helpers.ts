import { expect, type Browser, type Page } from "@playwright/test";

export const PASSWORD = "Passw0rd!x";
export const uniq = (tag: string) => `e2e.${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@test.example`;
export const stamp = () => `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

export type RegOpts = { email: string; name?: string; role?: "donor" | "requester"; group?: string; city?: string; phone?: string };
export async function register(page: Page, o: RegOpts) {
  await page.goto(`/register?role=${o.role ?? "donor"}`);
  await page.getByLabel("Full name").fill(o.name ?? "Test Person");
  await page.getByLabel("Email").fill(o.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("City").fill(o.city ?? "Lahore");
  if (o.phone) await page.getByLabel(/Phone/).fill(o.phone);
  if ((o.role ?? "donor") === "donor") await page.getByLabel("Blood group").selectOption(o.group ?? "O+");
  await page.getByLabel(/I am 18 or older/).check();
  await page.getByRole("button", { name: "Create account" }).click();
}
export const login = async (page: Page, email: string, password = PASSWORD) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};
export const signOut = async (page: Page) => { await page.getByRole("button", { name: "Sign out" }).click(); await page.waitForURL("/"); };

/** A fresh browser context (= separate cookie jar = separate person) signed in as a new account. */
export async function newUser(browser: Browser, o: RegOpts) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await register(page, o); await page.waitForURL(/\/dashboard\//);
  return { ctx, page };
}
export async function newAdmin(browser: Browser) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await login(page, "admin@demo.example", "Demo@12345"); await page.waitForURL(/\/dashboard\/admin/);
  return { ctx, page };
}
/** Walks the 3-step wizard and submits. Returns after the redirect to the new request's detail page. */
export async function submitRequest(page: Page, o: { hospital: string; city: string; group?: string; alias?: string }) {
  await page.goto("/dashboard/requester/new-request");
  await page.getByLabel("Patient alias / initials").fill(o.alias ?? "Pat X.");
  await page.getByLabel("Blood group needed").selectOption(o.group ?? "A+");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("City").fill(o.city);
  await page.getByLabel("Hospital / blood bank").fill(o.hospital);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Check your request" })).toBeVisible();
  await expect(page.getByText(o.hospital)).toBeVisible();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.waitForURL(/\/dashboard\/requester\/requests\/\d+/);
}
/** Approves via the admin review dialog (verification method + attestation required). */
export async function adminApprove(page: Page, hospital: string) {
  await page.goto("/dashboard/admin/review");
  const card = page.locator("li", { hasText: hospital });
  await card.getByRole("button", { name: "Approve…" }).click();
  const dialog = page.getByRole("dialog", { name: "Approve this request?" });
  await dialog.getByRole("button", { name: "Approve and notify donors" }).click();
  await expect(dialog.getByText("Choose how the request was verified")).toBeVisible(); // incomplete verification is refused
  await dialog.getByLabel("How was it verified?").selectOption("hospital_call");
  await dialog.getByLabel(/I verified this request/).check();
  await dialog.getByRole("button", { name: "Approve and notify donors" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("li", { hasText: hospital })).toHaveCount(0); // left the queue
}

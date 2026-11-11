// Stage 7: automated accessibility (axe-core, WCAG 2.1 A/AA), keyboard-only flows, PWA + service-worker privacy, expired sessions.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
async function axe(page: Page, label: string) {
  // Measure the SETTLED page: contrast checks on an element that is still fading in are meaningless (seen once as a rare false "color-contrast" on the hero pill).
  await page.evaluate(() => document.fonts.ready.then(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))));
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.violations.map((v) => `${label}: ${v.id} (${v.impact}) x${v.nodes.length} ${v.nodes[0]?.target?.join(" ")}`), `axe violations on ${label}`).toEqual([]);
}

test.describe("accessibility (axe-core)", () => {
  for (const path of ["/", "/login", "/register", "/forgot-password", "/demo/donor", "/demo/admin"]) {
    test(`public page ${path}`, async ({ page }) => { await page.goto(path); await expect(page.locator("main, h1").first()).toBeVisible(); await axe(page, path); });
  }
  const SCREENS: [string, string, string[]][] = [
    ["donor1@demo.example", "donor", ["", "opportunities", "offers", "profile", "notifications", "assistant", "analytics"]],
    ["requester1@demo.example", "requester", ["", "requests", "new-request", "analytics"]],
    ["admin@demo.example", "admin", ["", "review", "requests", "users", "donors", "reports"]],
  ];
  for (const [email, role, sections] of SCREENS) {
    test(`${role} dashboard screens`, async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, email, "Demo@12345"); await page.waitForURL(/\/dashboard\//);
      for (const s of sections) { await page.goto(`/dashboard/${role}/${s}`.replace(/\/$/, "")); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); if (s === "reports" || s === "analytics") await page.getByTestId("chart").first().waitFor(); await axe(page, `${role}/${s || "home"}`); }
    });
  }
});

test.describe("keyboard navigation", () => {
  test("skip link is first, visible on focus, and moves focus to the main content", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard focus order is a desktop concern");
    await page.goto("/"); await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /skip to/i }); await expect(skip).toBeFocused(); await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter"); await expect(page).toHaveURL(/#main$/);
  });
  test("sign in with the keyboard only", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop keyboard flow");
    await page.goto("/login"); await page.getByLabel("Email").focus();
    await page.keyboard.type("donor1@demo.example"); await page.keyboard.press("Tab"); await page.keyboard.type("Demo@12345"); await page.keyboard.press("Enter");
    await page.waitForURL(/\/dashboard\/donor/);
  });
  test("analytics filters and data-table disclosure work from the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop keyboard flow");
    await login(page, "admin@demo.example", "Demo@12345"); await page.waitForURL(/\/dashboard\/admin/);
    await page.goto("/dashboard/admin/reports"); await page.waitForSelector(".recharts-surface");
    await page.getByTestId("filters").getByLabel("City", { exact: true }).focus(); await page.keyboard.type("Lahore"); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/city=Lahore/); await page.getByTestId("filters").getByLabel("City", { exact: true }).fill(""); await page.keyboard.press("Enter"); await page.waitForSelector(".recharts-surface");
    const chart = page.locator('[data-testid="chart"][data-empty="false"]').first(), summary = chart.getByText("View as data table"); await summary.focus(); await page.keyboard.press("Enter");
    await expect(chart.getByRole("table")).toBeVisible();
    const focusRing = await summary.evaluate((el) => getComputedStyle(el).outlineStyle !== "none" || getComputedStyle(el).boxShadow !== "none"); expect(focusRing).toBe(true);
  });
});

test.describe("PWA and service-worker privacy", () => {
  test("manifest is installable and the service worker caches only static assets", async ({ page, context, baseURL }) => {
    const m = await (await page.request.get("/manifest.webmanifest")).json();
    expect(m).toMatchObject({ name: expect.any(String), start_url: "/", display: "standalone" });
    expect(m.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true); expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    for (const i of m.icons) expect((await page.request.get(i.src)).status()).toBe(200);
    const sw = await page.request.get("/sw.js"); expect(sw.status()).toBe(200); expect(sw.headers()["content-type"]).toMatch(/javascript/);
    await login(page, "donor1@demo.example", "Demo@12345"); await page.waitForURL(/\/dashboard\/donor/);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    for (const p of ["/dashboard/donor/offers", "/dashboard/donor/profile", "/dashboard/donor/notifications", "/dashboard/donor/analytics"]) { await page.goto(p); await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(400); }
    const urls = await page.evaluate(async () => { const out: string[] = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
    expect(urls).toContain("/offline.html");
    expect(urls.filter((u) => !(u === "/offline.html" || u.startsWith("/_next/static/") || u.startsWith("/icons/"))), "nothing user-specific may be cached").toEqual([]);
    await context.setOffline(true);                                                                   // an offline navigation shows the generic page, never cached private HTML
    await page.goto("/dashboard/donor/offers").catch(() => {}); await expect(page.getByText(/offline/i).first()).toBeVisible(); await expect(page.locator("body")).not.toContainText(/Hello,|My offers|Opportunities/);
    await context.setOffline(false); void baseURL;
  });
});

test.describe("sessions", () => {
  test("an expired or tampered session is sent to sign-in and APIs answer 401", async ({ page, context }) => {
    await login(page, "donor1@demo.example", "Demo@12345"); await page.waitForURL(/\/dashboard\/donor/);
    expect((await page.request.get("/api/notifications")).status()).toBe(200);
    const cookies = await context.cookies(); expect(cookies.some((c) => c.httpOnly)).toBe(true);        // session cookies are not readable by scripts
    await context.addCookies(cookies.map((c) => ({ ...c, value: c.name.includes("auth-token") ? "tampered" : c.value })));
    await page.goto("/dashboard/donor"); await expect(page).toHaveURL(/\/login\?next=/);
    await context.clearCookies(); await page.goto("/dashboard/admin/reports"); await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fadmin%2Freports/);
    for (const u of ["/api/notifications", "/api/reports/donor.offers"]) expect((await page.request.get(u)).status()).toBe(401);
    expect((await page.request.post("/api/ai/chat", { data: { message: "hi" } })).status()).toBe(401);
  });
  test("health endpoint is public, minimal and no-store", async ({ request }) => {
    const r = await request.get("/api/health"); expect(r.status()).toBe(200); expect(r.headers()["cache-control"]).toContain("no-store");
    expect(await r.json()).toEqual({ ok: true, db: "up" });
  });
});

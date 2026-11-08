import { expect, test } from "@playwright/test";

test("landing renders brand, hero and compatibility explorer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Right donor");
  await page.getByRole("button", { name: "I need blood" }).click();
  await page.getByRole("button", { name: "AB+", exact: true }).click();
  await expect(page.getByText("AB+ recipients can preliminarily receive from:")).toBeVisible();
  expect(errors).toEqual([]);
});

test("landing and dashboard have no horizontal overflow at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/demo/admin");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.goto("/");
  await page.waitForTimeout(1200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});

test("registration validates inputs", async ({ page }) => {
  await page.goto("/register");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Please confirm you are 18+")).toBeVisible();
});

test("demo dashboards work for each role and reject unknown roles", async ({ page }) => {
  for (const [role, heading] of [["donor", "Hello, Ayesha"], ["requester", "Hello, Sana"], ["admin", "Analytics"]] as const) {
    await page.goto(`/demo/${role}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  }
  await expect(page.getByRole("note")).toContainText("Demo mode");
  expect((await page.goto("/demo/hacker"))?.status()).toBe(404);
});

test("PWA manifest is served", async ({ request }) => {
  const m = await (await request.get("/manifest.webmanifest")).json();
  expect(m.display).toBe("standalone");
  expect(m.icons.length).toBeGreaterThanOrEqual(3);
});

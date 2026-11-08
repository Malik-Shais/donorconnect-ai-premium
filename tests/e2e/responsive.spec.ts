// Regression guard: no horizontal page overflow on any dashboard screen at phone, tablet and desktop widths (seeded accounts).
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const SCREENS: Record<string, string[]> = {
  "donor1@demo.example": ["donor", "donor/opportunities", "donor/offers", "donor/profile", "donor/notifications", "donor/assistant"],
  "requester1@demo.example": ["requester", "requester/requests", "requester/new-request", "requester/notifications", "requester/profile", "requester/assistant"],
  "admin@demo.example": ["admin", "admin/review", "admin/requests", "admin/users", "admin/donors", "admin/notifications", "admin/assistant"],
};

test.skip(({ isMobile }) => isMobile, "widths are set explicitly; run once on the desktop project");
for (const width of [360, 390, 768, 1280]) {
  test(`no horizontal overflow at ${width}px for every role's screens`, async ({ browser }) => {
    const bad: string[] = [];
    for (const [email, paths] of Object.entries(SCREENS)) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } }); const page = await ctx.newPage();
      await login(page, email, "Demo@12345"); await page.waitForURL(/\/dashboard\//);
      for (const path of paths) {
        await page.goto(`/dashboard/${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 0) bad.push(`${path} (+${over}px)`);
      }
      await ctx.close();
    }
    expect(bad, `overflowing screens at ${width}px`).toEqual([]);
  });
}

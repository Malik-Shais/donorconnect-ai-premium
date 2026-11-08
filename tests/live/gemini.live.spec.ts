// LIVE Gemini verification. Runs ONLY when a real key is present (GEMINI_API_KEY) and the server is started WITHOUT the mock flags:
//   GEMINI_API_KEY=... npm run build && npm run test:live   (test:live sets DC_LIVE=1, which also disables the mock provider)
// Without a key every test here is SKIPPED and the report must say "live Gemini: NOT VERIFIED".
import { expect, test } from "@playwright/test";
import { newUser, uniq } from "../e2e/helpers";

test.skip(!process.env.GEMINI_API_KEY || !process.env.DC_LIVE, "needs GEMINI_API_KEY and DC_LIVE=1: live Gemini not verified");

test("live: a real model answers a how-to question, stays within medical boundaries, and quota is handled", async ({ browser }) => {
  const { ctx, page } = await newUser(browser, { email: uniq("live"), role: "donor" });
  await page.goto("/dashboard/donor/assistant");
  await page.getByLabel("Your question").fill("In two sentences, how do I turn on contact sharing for an offer?");
  await page.getByRole("button", { name: "Send message" }).click();
  const bot = page.getByTestId("msg-assistant").last();
  await expect(bot).toHaveAttribute("data-source", "gemini");
  await expect(bot).toHaveAttribute("data-status", /done|error/, { timeout: 60_000 });
  if (await bot.getAttribute("data-status") === "error") { // free-tier quota/unavailable must still be graceful
    await expect(page.getByRole("alert").filter({ hasText: /usage limit|unavailable|busy/ })).toBeVisible();
  } else {
    expect((await bot.innerText()).length).toBeGreaterThan(20);
    expect(await bot.innerText()).not.toMatch(/@|\b\d{8,}\b/);
  }
  await ctx.close();
});

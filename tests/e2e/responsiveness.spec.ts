import { expect, test } from "@playwright/test";
import { newUser, uniq } from "./helpers";

// Buttons must show a busy state the moment they are clicked and must not send a second request while the first is running.
// The server-action response is delayed so the pending window is long enough to observe on any machine.
test("a submit button is disabled and busy immediately and a second click sends no second request", async ({ browser }) => {
  const u = await newUser(browser, { email: uniq("busy"), role: "donor", city: `Busy${Date.now()}`, phone: "0300 1112223" });
  const page = u.page; await page.goto("/dashboard/donor/profile");
  let posts = 0;
  await page.route("**/dashboard/donor/profile", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) { posts++; await new Promise((r) => setTimeout(r, 1500)); }
    await route.continue();
  });
  const save = page.getByRole("button", { name: "Save changes" });
  await save.click();
  await expect(save).toBeDisabled({ timeout: 500 });          // feedback within half a second even though the server is slow
  await expect(save).toHaveAttribute("aria-busy", "true");
  await save.click({ force: true, noWaitAfter: true }).catch(() => {}); // a second click while busy is ignored
  await expect(page.getByText("Profile saved")).toBeVisible();
  expect(posts).toBe(1);
  await expect(save).toBeEnabled();                             // and the button recovers afterwards
  await u.ctx.close();
});

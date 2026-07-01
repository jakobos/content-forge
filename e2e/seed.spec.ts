import { test, expect } from "@playwright/test";

test("created campaign persists after page reload", async ({ page }) => {
  const campaignName = `Test Campaign ${Date.now()}`;
  await page.goto("/campaigns");

  await page.getByRole("link", { name: "+ New Campaign" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill(campaignName);
  await page.getByRole("button", { name: "Create Campaign" }).click();

  await expect(page.getByRole("heading", { name: campaignName })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: campaignName })).toBeVisible();
});

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  const response = await request.post("http://127.0.0.1:8787/debug/reset");
  expect(response.ok()).toBe(true);
  const api = await request.post("http://127.0.0.1:4173/debug/reset-api");
  expect(api.ok()).toBe(true);
});

test("replacement disconnects the old device and an attacker cannot pair", async ({
  browser,
}) => {
  const oldContext = await browser.newContext();
  const attackerContext = await browser.newContext();
  const replacementContext = await browser.newContext();
  const oldDevice = await oldContext.newPage();
  const attacker = await attackerContext.newPage();
  const replacement = await replacementContext.newPage();

  await oldDevice.goto("/");
  await expect(
    oldDevice.getByRole("heading", { name: "Koppel dit apparaat" }),
  ).toBeVisible();
  await oldDevice.getByLabel("Beheerpincode").fill("000000");
  await oldDevice
    .getByRole("button", { name: "Dit apparaat koppelen" })
    .click();
  await expect(
    oldDevice.getByRole("heading", { name: "Hallo Luca!" }),
  ).toBeVisible();
  await expect(oldDevice.locator("#connection-label")).toHaveText("Online");

  await attacker.goto("/");
  await attacker.getByLabel("Beheerpincode").fill("111111");
  await attacker.getByRole("button", { name: "Dit apparaat koppelen" }).click();
  await expect(attacker.locator("#pair-message")).toHaveText(
    "De beheerpincode klopt niet.",
  );
  await expect(
    attacker.getByRole("heading", { name: "Hallo Luca!" }),
  ).toHaveCount(0);

  await replacement.goto("/");
  await replacement.getByLabel("Beheerpincode").fill("000000");
  await replacement
    .getByRole("button", { name: "Dit apparaat koppelen" })
    .click();
  await expect(replacement.locator("#replace-panel")).toBeVisible();
  await replacement
    .getByRole("button", { name: "Ja, oud apparaat vervangen" })
    .click();
  await expect(
    replacement.getByRole("heading", { name: "Hallo Luca!" }),
  ).toBeVisible();
  await expect(replacement.locator("#connection-label")).toHaveText("Online");
  // Replacing a device revokes it through the pairing API, the room closes its
  // socket, and its own reconnect is refused because its generation is stale.
  // That is three hops, so the budget is generous; what matters is that the old
  // device ends up unable to play.
  await expect(oldDevice.locator("#connection-label")).not.toHaveText(
    "Online",
    {
      timeout: 30_000,
    },
  );
  await expect(oldDevice.locator("#pause-button")).toBeDisabled();

  await oldContext.close();
  await attackerContext.close();
  await replacementContext.close();
});

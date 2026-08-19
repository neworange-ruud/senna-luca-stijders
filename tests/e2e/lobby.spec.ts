import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  expect((await request.post("http://127.0.0.1:8787/debug/reset")).ok()).toBe(
    true,
  );
  expect(
    (await request.post("http://127.0.0.1:4173/debug/reset-api")).ok(),
  ).toBe(true);
});

async function pair(page: Page, role: "Luca" | "Senna"): Promise<void> {
  await page.goto("/");
  await page.getByRole("radio", { name: role }).check();
  await page.getByLabel("Beheerpincode").fill("000000");
  await page.getByRole("button", { name: "Dit apparaat koppelen" }).click();
  await expect(
    page.getByRole("heading", { name: `Hallo ${role}!` }),
  ).toBeVisible();
  await expect(page.locator("#connection-label")).toHaveText("Online");
}

test("Luca and Senna choose one world and enter the same countdown", async ({
  browser,
}, testInfo) => {
  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");
  await luca.reload();
  await expect(
    luca.getByRole("heading", { name: "Hallo Luca!" }),
  ).toBeVisible();

  await luca.getByRole("button", { name: "Strand" }).click();
  await expect(senna.getByRole("button", { name: "Strand" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await senna.getByRole("button", { name: "Deze wereld is goed" }).click();
  await luca.getByRole("button", { name: "Ridder" }).click();
  await expect(luca.getByRole("button", { name: "Ridder" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await senna.getByRole("button", { name: "Piraat" }).click();
  await expect(senna.getByRole("button", { name: "Piraat" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  if (testInfo.project.name === "chromium") {
    await luca.screenshot({ path: "docs/checkpoints/phase-06-lobby.png" });
  }
  await luca.getByRole("button", { name: "Ik ben klaar" }).click();
  await expect(luca.getByRole("button", { name: "Klaar!" })).toBeVisible();
  await senna.getByRole("button", { name: "Ik ben klaar" }).click();

  await expect(luca.locator("#phase-status")).toHaveText("Aftellen");
  await expect(senna.locator("#phase-status")).toHaveText("Aftellen");
  await expect(luca.locator("#phase-status")).toHaveText("Spelen", {
    timeout: 5_000,
  });
  await expect(senna.locator("#phase-status")).toHaveText("Spelen", {
    timeout: 5_000,
  });
  await lucaContext.close();
  await sennaContext.close();
});

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const WORKER = "http://127.0.0.1:8787";

test.setTimeout(180_000);

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${WORKER}/debug/reset`)).ok()).toBe(true);
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
}

/** Starts a match in a named world, chosen the way the children choose it. */
async function startMatch(
  luca: Page,
  senna: Page,
  world: string,
): Promise<void> {
  await expect(luca.getByRole("button", { name: world })).toBeEnabled();
  await luca.getByRole("button", { name: world }).click();
  await senna.getByRole("button", { name: "Deze wereld is goed" }).click();
  await luca.getByRole("button", { name: "Ridder" }).click();
  await senna.getByRole("button", { name: "Piraat" }).click();
  await luca.getByRole("button", { name: "Ik ben klaar" }).click();
  await senna.getByRole("button", { name: "Ik ben klaar" }).click();
  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Spelen", {
      timeout: 12_000,
    });
  }
}

async function place(
  request: APIRequestContext,
  role: "luca" | "senna",
  x: number,
  y: number,
): Promise<void> {
  const response = await request.post(
    `${WORKER}/debug/give-weapon?role=${role}&item=nerf&x=${x}&y=${y}`,
  );
  expect(response.ok()).toBe(true);
}

/** Where the HUD says a pair of feet is, in arena units. */
function footY(page: Page, which: "own" | "peer" = "own"): Promise<number> {
  return page
    .locator("#opponent-status")
    .getAttribute(which === "own" ? "data-own-y" : "data-peer-y")
    .then((value) => Number(value ?? "0"));
}

test("the chosen world decides the ground the children play on", async ({
  browser,
}) => {
  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");
  await startMatch(luca, senna, "Boot");

  for (const page of [luca, senna]) {
    await expect(page.locator("#world-status")).toHaveText("Boot");
  }
  // The boat is the smallest world, and its deck is higher than a beach floor.
  await expect.poll(() => footY(luca), { timeout: 10_000 }).toBe(1_000);
  await luca.screenshot({ path: "docs/checkpoints/phase-09-boat.png" });

  await lucaContext.close();
  await sennaContext.close();
});

test("a lift carries a child to the roof and explains itself first", async ({
  browser,
  request,
}) => {
  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");
  await startMatch(luca, senna, "Stad");

  for (const page of [luca, senna]) {
    await expect(page.locator("#world-status")).toHaveText("Stad");
  }

  // Standing at the western lift, on the street.
  await place(request, "luca", 300, 1_200);
  await expect.poll(() => footY(luca), { timeout: 10_000 }).toBe(1_200);

  // The hint names the lift before it is used, which is how the destination is
  // made clear without a menu.
  const hint = luca.locator("#hint-line");
  await expect(hint).toBeVisible();
  await expect(luca.locator("#hint-text")).toContainText("Lift west");

  await luca.getByRole("button", { name: "Actie" }).click();
  // The roof is 320 units above the street and no jump can reach it.
  await expect.poll(() => footY(luca), { timeout: 10_000 }).toBe(880);
  await luca.screenshot({ path: "docs/checkpoints/phase-09-city-roof.png" });

  // The other player sees the same move, because the server decided it.
  await expect.poll(() => footY(senna, "peer"), { timeout: 10_000 }).toBe(880);

  await lucaContext.close();
  await sennaContext.close();
});

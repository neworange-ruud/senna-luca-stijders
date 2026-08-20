import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Journeys that stand directly behind a PRD acceptance criterion which the unit
 * suites can only cover halfway: coming back from outside the world without
 * losing anything, and a device that was paired days ago being ready to play
 * again quickly.
 */

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

function hearts(page: Page, which: "own" | "peer"): Promise<number> {
  return page
    .locator(`#${which}-hearts`)
    .evaluate(
      (element) =>
        element.querySelectorAll(".heart:not([data-lost='true'])").length,
    );
}

function footY(page: Page, which: "own" | "peer" = "own"): Promise<number> {
  return page
    .locator("#opponent-status")
    .getAttribute(which === "own" ? "data-own-y" : "data-peer-y")
    .then((value) => Number(value ?? "0"));
}

async function placeInPit(request: APIRequestContext): Promise<void> {
  // The gap in the space planet, above the crater island and beside it.
  const response = await request.post(
    `${WORKER}/debug/give-weapon?role=luca&item=nerf&x=1200&y=1100`,
  );
  expect(response.ok()).toBe(true);
}

test("falling out of the world costs nothing and comes back safe", async ({
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
  await startMatch(luca, senna, "Ruimteplaneet");

  expect(await hearts(luca, "own")).toBe(10);
  await placeInPit(request);

  // Gravity does the rest: the fall boundary sits below the ground.
  await expect.poll(() => footY(luca), { timeout: 15_000 }).toBe(1_200);
  expect(await hearts(luca, "own")).toBe(10);
  expect(await hearts(senna, "peer")).toBe(10);

  // Coming back is protected, and the child is told so.
  await expect(luca.locator("#protection-status")).toBeVisible();
  await luca.screenshot({ path: "docs/checkpoints/phase-10-respawn.png" });

  // The protection runs out on its own, so it cannot be used to camp.
  await expect(luca.locator("#protection-status")).toBeHidden({
    timeout: 10_000,
  });

  await lucaContext.close();
  await sennaContext.close();
});

test("a device that was paired before is playing again within two minutes", async ({
  browser,
}) => {
  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");

  // Both iPads are closed and opened again. The stored device credential is all
  // they have: no pin, no pairing, no adult.
  const started = Date.now();
  await Promise.all([luca.reload(), senna.reload()]);
  for (const [page, name] of [
    [luca, "Luca"],
    [senna, "Senna"],
  ] as const) {
    await expect(
      page.getByRole("heading", { name: `Hallo ${name}!` }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#connection-label")).toHaveText("Online", {
      timeout: 30_000,
    });
  }
  await startMatch(luca, senna, "Strand");
  const seconds = (Date.now() - started) / 1_000;
  expect(seconds).toBeLessThan(120);
  console.log(`RETURNING_DEVICE_SECONDS ${seconds.toFixed(1)}`);

  await lucaContext.close();
  await sennaContext.close();
});

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const WORKER = "http://127.0.0.1:8787";

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
  await expect(page.locator("#connection-label")).toHaveText("Online");
}

async function startMatch(luca: Page, senna: Page): Promise<void> {
  await expect(luca.getByRole("button", { name: "Strand" })).toBeEnabled();
  await luca.getByRole("button", { name: "Strand" }).click();
  await senna.getByRole("button", { name: "Deze wereld is goed" }).click();
  await luca.getByRole("button", { name: "Ridder" }).click();
  await senna.getByRole("button", { name: "Piraat" }).click();
  await luca.getByRole("button", { name: "Ik ben klaar" }).click();
  await senna.getByRole("button", { name: "Ik ben klaar" }).click();
  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Spelen", {
      timeout: 6_000,
    });
  }
}

/** Development-only helper that stands in for a chest until Phase 7. */
async function giveWeapon(
  request: APIRequestContext,
  role: "luca" | "senna",
  item: "sword" | "weak-sword" | "nerf",
  position?: { x: number; y: number },
): Promise<void> {
  const query = new URLSearchParams({ role, item });
  if (position) {
    query.set("x", String(position.x));
    query.set("y", String(position.y));
  }
  const response = await request.post(
    `${WORKER}/debug/give-weapon?${query.toString()}`,
  );
  expect(response.ok()).toBe(true);
}

function hearts(page: Page, which: "own" | "peer"): Promise<number> {
  return page
    .locator(`#${which}-hearts`)
    .evaluate(
      (element) =>
        element.querySelectorAll(".heart:not([data-lost='true'])").length,
    );
}

/**
 * Presses a control and then waits out the longest weapon cooldown, because the
 * server owns the attack cadence and rejects a swing that comes too early.
 */
async function tap(page: Page, key: string, milliseconds = 90): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(key);
  await page.waitForTimeout(750);
}

test("two paired clients fight an authoritative duel with every weapon", async ({
  browser,
  request,
}, testInfo) => {
  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");
  await startMatch(luca, senna);

  // Both fighters start armed and within reach of each other.
  await giveWeapon(request, "luca", "sword", { x: 700, y: 1_104 });
  await giveWeapon(request, "senna", "nerf", { x: 844, y: 1_104 });
  await expect(luca.locator("#weapon-status")).toHaveText("Zwaard");
  await expect(senna.locator("#weapon-status")).toHaveText(
    "Blaster · 6 pijltjes",
  );

  // An unblocked sword takes two hearts, and both devices agree.
  await tap(luca, "KeyF");
  await expect.poll(() => hearts(senna, "own"), { timeout: 6_000 }).toBe(8);
  await expect.poll(() => hearts(luca, "peer"), { timeout: 6_000 }).toBe(8);

  // A dart takes one heart from Luca.
  await tap(senna, "KeyF");
  await expect.poll(() => hearts(luca, "own"), { timeout: 6_000 }).toBe(9);
  await expect(senna.locator("#weapon-status")).toHaveText(
    "Blaster · 5 pijltjes",
  );

  // Blocking towards the attacker keeps one heart of the sword out.
  await senna.keyboard.down("ShiftLeft");
  await senna.waitForTimeout(150);
  await tap(luca, "KeyF", 120);
  await expect.poll(() => hearts(senna, "own"), { timeout: 6_000 }).toBe(7);
  await senna.keyboard.up("ShiftLeft");

  // A long press swings once on contact and then throws the sword on release,
  // so Senna loses two hearts to the swing and two to the flying sword.
  await tap(luca, "KeyF", 800);
  await expect(luca.locator("#weapon-status")).toHaveText("Vuisten");
  await expect.poll(() => hearts(senna, "own"), { timeout: 6_000 }).toBe(3);

  // Action recovers the thrown sword from the ground.
  await tap(luca, "KeyE", 200);
  await expect(luca.locator("#weapon-status")).toHaveText("Zwaard", {
    timeout: 6_000,
  });

  // The switch control cycles back to bare fists, which reach less far.
  await tap(luca, "KeyQ");
  await expect(luca.locator("#weapon-status")).toHaveText("Vuisten");

  await luca.screenshot({ path: testInfo.outputPath("duel-luca.png") });
  if (testInfo.project.name === "chromium") {
    await luca.screenshot({ path: "docs/checkpoints/phase-06-duel.png" });
  }
  await lucaContext.close();
  await sennaContext.close();
});

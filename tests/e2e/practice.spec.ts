import { expect, test, type Page } from "@playwright/test";

function distance(page: Page): Promise<number> {
  return page
    .locator("#opponent-status")
    .evaluate((element) => Number((element as HTMLElement).dataset.distance));
}

function hearts(page: Page): Promise<number> {
  return page
    .locator("#own-hearts")
    .evaluate(
      (element) =>
        element.querySelectorAll(".heart:not([data-lost='true'])").length,
    );
}

function peerHearts(page: Page): Promise<number> {
  return page
    .locator("#peer-hearts")
    .evaluate(
      (element) =>
        element.querySelectorAll(".heart:not([data-lost='true'])").length,
    );
}

/** Presses a control with the keyboard for a while, then releases it. */
async function hold(page: Page, key: string, milliseconds: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(key);
}

test("test mode runs a solo match without pairing a second device", async ({
  page,
}, testInfo) => {
  await page.goto("/?test=luca");
  // The play view covers the page, so only the test panel and the canvas stay
  // visible; the remaining status elements are asserted by their text.
  await expect(page.getByLabel("Testmodus")).toBeVisible();
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("#player-title")).toHaveText("Hallo Luca!");
  await expect(page.locator("#connection-label")).toHaveText("Testmodus");
  await expect(page.locator("#phase-status")).toHaveText("Spelen");
  expect(await hearts(page)).toBe(10);
  await expect(page.locator("#own-hearts")).toHaveAttribute(
    "aria-label",
    "10 van de 10 harten",
  );
  await expect(page.locator("#weapon-status")).toHaveText("Vuisten");

  await page.getByLabel("Oefenpop").selectOption("idle");
  const before = await distance(page);
  await hold(page, "ArrowRight", 600);
  expect(await distance(page)).toBeLessThan(before);

  await page.getByLabel("Oefenpop").selectOption("fight");
  await expect.poll(() => hearts(page), { timeout: 15_000 }).toBeLessThan(10);

  await page.getByRole("button", { name: "Opnieuw beginnen" }).click();
  await expect.poll(() => hearts(page), { timeout: 5_000 }).toBe(10);

  // The test controls must stay reachable above the full-screen play view on an
  // iPad landscape viewport.
  await page.setViewportSize({ width: 1180, height: 820 });
  const panel = await page.getByLabel("Testmodus").boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(1180);
  await expect(page.locator(".game-hud")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aanval" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("test-mode.png") });
  if (testInfo.project.name === "chromium") {
    await page.screenshot({ path: "docs/checkpoints/phase-06-testmode.png" });
  }
});

test("every weapon works from the browser against the training opponent", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/?test=luca");
  await expect(page.locator("#phase-status")).toHaveText("Spelen");
  // The training opponent walks up to the player, so the test does not have to
  // guess where either fighter stands.
  await page.getByLabel("Oefenpop").selectOption("follow");
  await expect.poll(() => distance(page), { timeout: 8_000 }).toBeLessThan(120);

  // A sword takes two hearts per hit.
  await page.getByLabel("Wapen").selectOption("sword");
  await expect(page.locator("#weapon-status")).toHaveText("Zwaard");
  await hold(page, "KeyF", 100);
  await expect.poll(() => peerHearts(page), { timeout: 8_000 }).toBe(8);
  const afterSword = await peerHearts(page);

  // Holding the attack control and releasing it throws the sword instead.
  await hold(page, "KeyF", 800);
  await expect(page.locator("#weapon-status")).toHaveText("Vuisten");
  await expect
    .poll(() => peerHearts(page), { timeout: 8_000 })
    .toBeLessThan(afterSword);

  // The blaster reports its remaining darts and spends one per shot.
  await page.getByLabel("Wapen").selectOption("nerf");
  await expect(page.locator("#weapon-status")).toHaveText(
    "Blaster · 6 pijltjes",
  );
  await hold(page, "KeyF", 100);
  await expect(page.locator("#weapon-status")).toHaveText(
    "Blaster · 5 pijltjes",
  );

  // Blocking is available and reported to the player as a pressed control.
  await page.keyboard.down("ShiftLeft");
  await expect(page.getByRole("button", { name: "Blok" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.up("ShiftLeft");

  await page.screenshot({ path: testInfo.outputPath("weapons.png") });
  if (testInfo.project.name === "chromium") {
    await page.screenshot({ path: "docs/checkpoints/phase-06-weapons.png" });
  }
});

test("sound and music have independent settings that survive a reload", async ({
  page,
}) => {
  await page.goto("/?test=luca");
  const effects = page.getByRole("button", { name: /Geluid/ });
  const music = page.getByRole("button", { name: /Muziek/ });
  // Music starts off so nothing plays before the player asks for it.
  await expect(effects).toHaveText("Geluid aan");
  await expect(music).toHaveText("Muziek uit");

  await effects.click();
  await music.click();
  await expect(effects).toHaveText("Geluid uit");
  await expect(music).toHaveText("Muziek aan");

  await page.reload();
  await expect(page.getByRole("button", { name: /Geluid/ })).toHaveText(
    "Geluid uit",
  );
  await expect(page.getByRole("button", { name: /Muziek/ })).toHaveText(
    "Muziek aan",
  );
});

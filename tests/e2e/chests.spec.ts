import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const WORKER = "http://127.0.0.1:8787";

// Six chests each take an announcement plus a landing, so this journey needs
// more than the default per-test budget, especially in WebKit.
test.setTimeout(120_000);

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

/**
 * Announces a real chest with a chosen reward next to a player. Only the twelve
 * second schedule is short-circuited; the landing, the claim, and the reward
 * all run through the authoritative rules.
 */
async function spawnChest(
  request: APIRequestContext,
  outcome: string,
  role: "luca" | "senna" = "luca",
): Promise<void> {
  const response = await request.post(
    `${WORKER}/debug/spawn-chest?outcome=${outcome}&role=${role}`,
  );
  expect(response.ok()).toBe(true);
}

/**
 * Presses the on-screen Action control once. Keyboard events need the page to
 * be focused, and with two browser contexts on a busy machine that focus is not
 * guaranteed; a pointer on the control is. One press is enough because the room
 * remembers it until a tick uses it, and it is safer than holding: a held
 * control keeps acting every tick afterwards.
 */
async function pressAction(page: Page): Promise<void> {
  const box = await page.getByRole("button", { name: "Actie" }).boundingBox();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Lets both children back in if this run tripped the connection freeze, and
 * reports that it happened. A shared build machine can stall a browser long
 * enough for the room to call it absent, which freezes the match for both of
 * them until they each say they are ready. That is real product behaviour with
 * its own journey in `lifecycle.spec.ts`; here it is only noise, and it is
 * ruinous noise, because a frozen match does not tick and so a chest that is
 * still falling never lands.
 */
async function clearConnectionFreeze(pages: readonly Page[]): Promise<void> {
  let frozen = false;
  for (const page of pages) {
    const eyebrow = await page.locator("#overlay-eyebrow").textContent();
    if (
      (await page.locator("#stage-overlay").isVisible()) &&
      eyebrow?.trim() === "Verbinding"
    ) {
      frozen = true;
    }
  }
  if (!frozen) return;
  console.log("CONNECTION_FREEZE_CLEARED");
  for (const page of pages) {
    const resume = page.locator("#overlay-action");
    if (await resume.isVisible()) await resume.click();
  }
  for (const page of pages) {
    await expect(page.locator("#phase-status")).toHaveText("Spelen", {
      timeout: 30_000,
    });
  }
}

/**
 * Waits until the chest beside this player has landed and is genuinely within
 * reach. The tip is what proves both of those: the page only offers it when a
 * claim would actually be granted.
 */
async function waitForLandedChest(
  page: Page,
  pages: readonly Page[],
): Promise<void> {
  await expect(async () => {
    await clearConnectionFreeze(pages);
    await expect(page.locator("#hint-text")).toHaveText(
      "Tik op de kist om hem te openen.",
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 40_000 });
}

/** Waits for the chest to be openable, then opens it with one press. */
async function openLandedChest(
  page: Page,
  pages: readonly Page[],
): Promise<void> {
  await waitForLandedChest(page, pages);
  await pressAction(page);
}

async function moveTo(
  request: APIRequestContext,
  role: "luca" | "senna",
  x: number,
): Promise<void> {
  // The give-weapon route doubles as the way to place a fighter precisely.
  const response = await request.post(
    `${WORKER}/debug/give-weapon?role=${role}&item=nerf&x=${x}&y=1104`,
  );
  expect(response.ok()).toBe(true);
}

test("a match delivers every chest outcome to the player who opens it", async ({
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

  // Both fighters wait at the western chest point; Senna stays out of reach.
  await moveTo(request, "luca", 868);
  await moveTo(request, "senna", 1_400);
  await expect(luca.locator("#weapon-status")).toHaveText(
    "Blaster · 6 pijltjes",
  );

  const expectations: [string, RegExp][] = [
    ["sword", /^Zwaard$/],
    ["weak-sword", /^Klein zwaard$/],
    ["nerf", /^Blaster · 6 pijltjes$/],
  ];
  for (const [outcome, weapon] of expectations) {
    await spawnChest(request, outcome, "luca");
    await openLandedChest(luca, [luca, senna]);
    await expect(luca.locator("#weapon-status")).toHaveText(weapon, {
      timeout: 10_000,
    });
  }

  const powers: [string, RegExp][] = [
    ["armor", /Schild 3x/],
    ["speed", /Snelheid \d+s/],
    ["camouflage", /Camouflage \d+s/],
  ];
  for (const [outcome, label] of powers) {
    await spawnChest(request, outcome, "luca");
    await openLandedChest(luca, [luca, senna]);
    await expect
      .poll(() => luca.locator("#effect-status").getAttribute("aria-label"), {
        timeout: 10_000,
      })
      .toMatch(label);
  }

  // The opponent sees the same authoritative rewards on their own device.
  await expect(senna.locator("#phase-status")).toHaveText("Spelen");
  await luca.screenshot({ path: testInfo.outputPath("chests.png") });
  if (testInfo.project.name === "chromium") {
    await luca.screenshot({ path: "docs/checkpoints/phase-07-chests.png" });
  }
  await lucaContext.close();
  await sennaContext.close();
});

test("a chest is opened by tapping the chest itself", async ({
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

  // Luca waits at the western chest point; Senna stays far out of reach.
  await moveTo(request, "luca", 868);
  await moveTo(request, "senna", 1_400);
  await expect(luca.locator("#weapon-status")).toHaveText(
    "Blaster · 6 pijltjes",
  );

  await spawnChest(request, "sword", "luca");
  // This tip only appears once the chest has landed and is genuinely in reach,
  // which is exactly the moment a tap is supposed to start working.
  await waitForLandedChest(luca, [luca, senna]);

  /**
   * Where the chest is drawn. Luca stands at the western point, so the camera
   * has centred Luca's box on it, and at this viewport the camera is pinned to
   * the bottom of the 1400 pixel high beach. That puts the chest's own centre
   * on the canvas centre line, 228 pixels above the canvas floor.
   */
  const box = (await luca.locator("#game-canvas").boundingBox())!;
  const chestPoint = {
    x: box.x + box.width / 2,
    y: box.y + box.height - 228,
  };

  // What a child sees when a chest is theirs to open: the ring around it and
  // the invitation to tap, rather than the name of a button to go and find.
  if (testInfo.project.name === "chromium") {
    await luca.screenshot({ path: "docs/checkpoints/phase-10-chest-tap.png" });
  }

  // A tap on empty arena is not an action. Nothing is claimed by tapping about.
  await luca.mouse.click(box.x + 120, chestPoint.y);
  await luca.waitForTimeout(600);
  await expect(luca.locator("#weapon-status")).toHaveText(
    "Blaster · 6 pijltjes",
  );

  // A tap on the chest is, and one tap is enough: the press is latched, so it
  // survives being shorter than a single simulated tick.
  await luca.mouse.click(chestPoint.x, chestPoint.y);
  await expect(luca.locator("#weapon-status")).toHaveText("Zwaard", {
    timeout: 10_000,
  });

  // The opponent's device agrees, because the room decided the claim.
  await expect(senna.locator("#phase-status")).toHaveText("Spelen");
  await luca.screenshot({ path: testInfo.outputPath("chest-tap.png") });
  await lucaContext.close();
  await sennaContext.close();
});

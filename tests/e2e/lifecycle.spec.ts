import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const WORKER = "http://127.0.0.1:8787";

// Pausing, going offline, coming back, and finishing a match all take real
// seconds, and a whole-suite run is markedly slower than a single spec, so
// these journeys need a generous per-test budget.
test.setTimeout(240_000);

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
      timeout: 8_000,
    });
  }
}

function overlay(page: Page) {
  return {
    title: page.locator("#overlay-title"),
    message: page.locator("#overlay-message"),
    status: page.locator("#overlay-status"),
    action: page.locator("#overlay-action"),
    root: page.locator("#stage-overlay"),
  };
}

function hearts(page: Page, which: "own" | "peer"): Promise<number> {
  return page
    .locator(`#${which}-hearts`)
    .evaluate(
      (element) =>
        element.querySelectorAll(".heart:not([data-lost='true'])").length,
    );
}

async function place(
  request: APIRequestContext,
  role: "luca" | "senna",
  x: number,
  health?: number,
): Promise<void> {
  const query = new URLSearchParams({
    role,
    item: "nerf",
    x: String(x),
    y: "1104",
  });
  if (health !== undefined) query.set("health", String(health));
  const response = await request.post(
    `${WORKER}/debug/give-weapon?${query.toString()}`,
  );
  expect(response.ok()).toBe(true);
}

test("a pause names who asked for it and needs both players to resume", async ({
  browser,
}) => {
  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");
  await startMatch(luca, senna);

  // Walk a little first, so a resume that quietly restarts the match instead
  // of continuing it would put both fighters back on their spawns.
  const box = await luca
    .getByRole("button", { name: "Naar rechts" })
    .boundingBox();
  await luca.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  const startedAt = Number(
    await luca.locator("#opponent-status").getAttribute("data-distance"),
  );
  await luca.mouse.down();
  await luca.waitForTimeout(800);
  await luca.mouse.up();
  // Wait until the server has actually reported the walk, so the reading is a
  // real position rather than one the snapshot has not caught up with.
  await expect
    .poll(
      async () =>
        Math.abs(
          Number(
            await luca
              .locator("#opponent-status")
              .getAttribute("data-distance"),
          ) - startedAt,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(150);
  const walkedTo = await luca
    .locator("#opponent-status")
    .getAttribute("data-distance");

  await luca.getByRole("button", { name: "Pauze" }).click();
  // The player who asked sees it first, then the other device.
  await expect(overlay(luca).title).toHaveText("Jij hebt gepauzeerd", {
    timeout: 10_000,
  });
  await expect(overlay(senna).title).toHaveText("Luca heeft gepauzeerd", {
    timeout: 10_000,
  });
  // The arena stays on screen behind the overlay.
  await expect(luca.locator("#game-canvas")).toBeVisible();

  // One player alone cannot resume the match.
  await overlay(luca).action.click();
  await expect(overlay(luca).status).toContainText("Wachten op Senna");
  await expect(senna.locator("#phase-status")).toHaveText("Gepauzeerd");

  await overlay(senna).action.click();
  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Spelen", {
      timeout: 10_000,
    });
    await expect(overlay(page).root).toBeHidden();
  }
  // A pause is not a restart: both children carry on from where they stood.
  // A few units of drift is the last of the run being braked off; being put
  // back on a spawn would be hundreds.
  const resumedAt = await luca
    .locator("#opponent-status")
    .getAttribute("data-distance");
  expect(Math.abs(Number(resumedAt) - Number(walkedTo))).toBeLessThan(100);
  await lucaContext.close();
  await sennaContext.close();
});

test("losing a connection freezes the match for both players until they return", async ({
  browser,
  browserName,
}) => {
  // WebKit's setOffline does not cut an already open WebSocket, so the network
  // variant runs in Chromium. The same guarantee is covered in both engines by
  // the soak, which closes the socket outright.
  test.skip(
    browserName === "webkit",
    "setOffline does not affect an open WebSocket in WebKit",
  );
  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");
  await startMatch(luca, senna);

  // Senna drops off the network mid-match.
  await sennaContext.setOffline(true);
  await expect(luca.locator("#phase-status")).not.toHaveText("Spelen", {
    timeout: 15_000,
  });
  await expect(overlay(luca).root).toBeVisible();
  // Luca is told what happened, in Dutch, and cannot play on alone.
  await expect(overlay(luca).title).toHaveText(
    /verbinding hapert|Verbinding herstellen/,
  );
  await expect(luca.locator("#peer-status")).toHaveText("Offline", {
    timeout: 15_000,
  });

  // Coming back restores the same match and waits for both players.
  await sennaContext.setOffline(false);
  await expect(senna.locator("#connection-label")).toHaveText("Online", {
    timeout: 30_000,
  });
  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Gepauzeerd", {
      timeout: 30_000,
    });
    expect(await hearts(page, "own")).toBe(10);
  }
  for (const page of [luca, senna]) {
    await overlay(page).action.click();
  }
  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Spelen", {
      timeout: 15_000,
    });
  }
  await lucaContext.close();
  await sennaContext.close();
});

test("a finished match shows the winner and restarts only with both players", async ({
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

  // Stand the two fighters next to each other and let Luca punch. Bare fists
  // are used on purpose: a held sword can be thrown, and this journey is about
  // finishing a match, not about weapon handling.
  // Bare fists reach 48 units, so the two stand shoulder to shoulder, and
  // Senna starts on her last heart. Grinding out nine authoritative hits adds
  // nothing here: the killing blow below is still a real punch, resolved by the
  // server, and the per-hit rules are covered by the combat suites.
  await place(request, "luca", 790);
  await place(request, "senna", 844, 1);
  await luca.keyboard.press("KeyQ");
  await expect(luca.locator("#weapon-status")).toHaveText("Vuisten");
  await expect.poll(() => hearts(senna, "own"), { timeout: 10_000 }).toBe(1);

  // Tap the on-screen control, which is how the children actually play and is
  // delivered reliably in both engines.
  const attack = luca.getByRole("button", { name: "Aanval" });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && (await hearts(senna, "own")) > 0) {
    await attack.click();
    await luca.waitForTimeout(750);
  }

  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Afgelopen", {
      timeout: 15_000,
    });
  }
  await expect(overlay(luca).title).toHaveText("Luca heeft gewonnen!");
  await expect(overlay(senna).title).toHaveText("Luca heeft gewonnen!");
  if (testInfo.project.name === "chromium") {
    await senna.screenshot({ path: "docs/checkpoints/phase-08-winner.png" });
  }

  // One player alone cannot restart it.
  await overlay(senna).action.click();
  await expect(overlay(senna).status).toContainText("Wachten op Luca");
  await expect(luca.locator("#phase-status")).toHaveText("Afgelopen");

  await overlay(luca).action.click();
  // The reset gives both players full hearts and hands the choice to Senna.
  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Wereld kiezen", {
      timeout: 15_000,
    });
    expect(await hearts(page, "own")).toBe(10);
    await expect(page.locator("#weapon-status")).toHaveText("Vuisten");
  }
  await expect(senna.locator("#chooser-message")).toHaveText(
    "Jij kiest deze ronde.",
  );
  await expect(luca.locator("#chooser-message")).toHaveText(
    "Senna kiest deze ronde.",
  );
  await lucaContext.close();
  await sennaContext.close();
});

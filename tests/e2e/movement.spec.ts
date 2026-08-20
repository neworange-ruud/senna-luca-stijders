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

async function startMatch(luca: Page, senna: Page): Promise<void> {
  await expect(luca.getByRole("button", { name: "Strand" })).toBeEnabled();
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
  await luca.getByRole("button", { name: "Ik ben klaar" }).click();
  await expect(luca.getByRole("button", { name: "Klaar!" })).toBeVisible();
  await senna.getByRole("button", { name: "Ik ben klaar" }).click();
  await expect(luca.locator("#phase-status")).toHaveText("Spelen", {
    timeout: 6_000,
  });
  await expect(senna.locator("#phase-status")).toHaveText("Spelen", {
    timeout: 6_000,
  });
}

function distance(page: Page): Promise<number> {
  return page
    .locator("#opponent-status")
    .evaluate((element) => Number((element as HTMLElement).dataset.distance));
}

test("both players move authoritatively and touch contacts combine", async ({
  browser,
}, testInfo) => {
  const device = {
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
    reducedMotion: "reduce" as const,
  };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");
  await startMatch(luca, senna);

  await expect(luca.locator("#game-canvas")).toBeVisible();
  const initialDistance = await distance(luca);
  await Promise.all([
    luca.keyboard.down("ArrowRight"),
    senna.keyboard.down("ArrowLeft"),
  ]);
  await luca.waitForTimeout(700);
  await Promise.all([
    luca.keyboard.up("ArrowRight"),
    senna.keyboard.up("ArrowLeft"),
  ]);
  await expect.poll(() => distance(luca)).toBeLessThan(initialDistance);

  const right = luca.getByRole("button", { name: "Naar rechts" });
  const jump = luca.getByRole("button", { name: "Spring" });
  await right.dispatchEvent("pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: false,
  });
  await jump.dispatchEvent("pointerdown", {
    pointerId: 42,
    pointerType: "touch",
    isPrimary: false,
  });
  await expect(right).toHaveAttribute("aria-pressed", "true");
  await expect(jump).toHaveAttribute("aria-pressed", "true");
  await jump.dispatchEvent("pointerup", {
    pointerId: 42,
    pointerType: "touch",
  });
  await right.dispatchEvent("pointerup", {
    pointerId: 41,
    pointerType: "touch",
  });
  await expect(right).toHaveAttribute("aria-pressed", "false");
  await expect(jump).toHaveAttribute("aria-pressed", "false");

  for (const [index, name] of ["Aanval", "Blok", "Actie", "Wissel"].entries()) {
    const action = luca.getByRole("button", { name });
    await right.dispatchEvent("pointerdown", {
      pointerId: 50 + index * 2,
      pointerType: "touch",
      isPrimary: false,
    });
    await action.dispatchEvent("pointerdown", {
      pointerId: 51 + index * 2,
      pointerType: "touch",
      isPrimary: false,
    });
    await expect(right).toHaveAttribute("aria-pressed", "true");
    await expect(action).toHaveAttribute("aria-pressed", "true");
    await action.dispatchEvent("pointerup", {
      pointerId: 51 + index * 2,
      pointerType: "touch",
    });
    await right.dispatchEvent("pointerup", {
      pointerId: 50 + index * 2,
      pointerType: "touch",
    });
  }

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1180, height: 820 },
    { width: 1366, height: 1024 },
  ]) {
    await luca.setViewportSize(viewport);
    const stage = await luca.locator("#game-stage").boundingBox();
    expect(stage).not.toBeNull();
    expect(stage!.x).toBeGreaterThanOrEqual(0);
    expect(stage!.y).toBeGreaterThanOrEqual(0);
    expect(stage!.x + stage!.width).toBeLessThanOrEqual(viewport.width);
    expect(stage!.y + stage!.height).toBeLessThanOrEqual(viewport.height);
    await expect(luca.locator(".game-hud")).toBeVisible();
    await expect(right).toBeVisible();
    await expect(jump).toBeVisible();
    await luca.screenshot({
      path: testInfo.outputPath(
        `movement-${viewport.width}x${viewport.height}.png`,
      ),
    });
    if (testInfo.project.name === "chromium" && viewport.width === 1180) {
      await luca.screenshot({ path: "docs/checkpoints/phase-05-movement.png" });
    }
  }

  // Asking for a pause only means anything while the match is running, and a
  // screenshot on a busy machine can stall a page long enough to freeze it.
  await expect(luca.locator("#phase-status")).toHaveText("Spelen", {
    timeout: 20_000,
  });
  const immediatePause = await luca
    .getByRole("button", { name: "Pauze" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      return { disabled: button.disabled, text: button.textContent };
    });
  expect(immediatePause).toEqual({
    disabled: true,
    text: "Pauze aanvragen...",
  });
  await expect(luca.locator("#phase-status")).toHaveText("Gepauzeerd");

  await lucaContext.close();
  await sennaContext.close();
});

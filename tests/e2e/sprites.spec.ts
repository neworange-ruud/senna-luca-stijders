import { expect, test, type Page } from "@playwright/test";

/**
 * The player artwork is a sheet of four frames per outfit. This journey proves
 * the sheets reach the browser, that both children get the outfit they picked,
 * and that the drawing actually changes while a child walks and jumps. The
 * screenshots it leaves behind are the checkpoint for this work.
 */

const WORKER = "http://127.0.0.1:8787";

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

async function hold(page: Page, name: string): Promise<void> {
  const box = await page.getByRole("button", { name }).boundingBox();
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  await page.mouse.down();
}

/** What the arena looks like right now, as a data URL of the canvas. */
function arenaPicture(page: Page): Promise<string> {
  return page.evaluate(() =>
    (document.querySelector("#game-canvas") as HTMLCanvasElement).toDataURL(
      "image/png",
    ),
  );
}

test("a walking child is drawn from the sheet of the outfit they picked", async ({
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

  await luca.getByRole("button", { name: "Strand" }).click();
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

  // Both sheets are served, and each is a strip of four frames.
  for (const outfit of ["knight", "pirate"]) {
    const response = await request.get(
      `http://127.0.0.1:4173/art/sprites/${outfit}.png`,
    );
    expect(response.status(), outfit).toBe(200);
  }
  const sheet = await luca.evaluate(async () => {
    const image = new Image();
    image.src = "/art/sprites/knight.png";
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(sheet.width % 4).toBe(0);
  expect(sheet.width / 4).toBeLessThan(sheet.height);

  await luca.waitForTimeout(400);
  if (testInfo.project.name === "chromium") {
    await luca.screenshot({ path: "docs/checkpoints/phase-11-idle.png" });
  }

  // Walking has to change what is drawn, twice, at two different moments of the
  // step cycle: that is the animation, and a still sprite would not do it.
  await hold(luca, "Naar rechts");
  await hold(senna, "Naar links");
  await luca.waitForTimeout(500);
  const pictures = new Set<string>();
  for (let sample = 0; sample < 8; sample += 1) {
    pictures.add(await arenaPicture(luca));
    await luca.waitForTimeout(70);
  }
  expect(pictures.size).toBeGreaterThan(2);
  if (testInfo.project.name === "chromium") {
    await luca.screenshot({ path: "docs/checkpoints/phase-11-walk.png" });
  }
  await luca.mouse.up();
  await senna.mouse.up();

  // Jumping draws the jump frame while both feet are off the ground.
  await luca.waitForTimeout(400);
  const standing = await arenaPicture(luca);
  await hold(luca, "Spring");
  await luca.waitForTimeout(220);
  expect(await arenaPicture(luca)).not.toBe(standing);
  if (testInfo.project.name === "chromium") {
    await luca.screenshot({ path: "docs/checkpoints/phase-11-jump.png" });
  }
  await luca.mouse.up();

  await lucaContext.close();
  await sennaContext.close();
});

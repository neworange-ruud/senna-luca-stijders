import { expect, test, type CDPSession, type Page } from "@playwright/test";

/**
 * A match played over a deliberately bad connection. Chromium can emulate
 * latency and a narrow pipe through the DevTools protocol, so this journey runs
 * there only; the reordering and replay rules themselves are covered by the
 * sequence tests, which is where ordering is actually decided.
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

async function slowDown(page: Page, milliseconds: number): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: milliseconds,
    downloadThroughput: (1_500 * 1_024) / 8,
    uploadThroughput: (750 * 1_024) / 8,
  });
  return session;
}

test("a match on a slow connection still agrees on both iPads", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Only Chromium can emulate network conditions through the DevTools protocol.",
  );

  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");

  // Both children now play over a connection with 200 ms of latency each way.
  const sessions = [await slowDown(luca, 200), await slowDown(senna, 200)];

  await luca.getByRole("button", { name: "Strand" }).click();
  await senna.getByRole("button", { name: "Deze wereld is goed" }).click();
  await luca.getByRole("button", { name: "Ridder" }).click();
  await senna.getByRole("button", { name: "Piraat" }).click();
  await luca.getByRole("button", { name: "Ik ben klaar" }).click();
  await senna.getByRole("button", { name: "Ik ben klaar" }).click();
  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Spelen", {
      timeout: 30_000,
    });
  }

  // Walk towards each other for a while, then let everything settle.
  const hold = async (page: Page, name: string): Promise<void> => {
    const box = await page.getByRole("button", { name }).boundingBox();
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    await page.mouse.down();
  };
  await hold(luca, "Naar rechts");
  await hold(senna, "Naar links");
  await luca.waitForTimeout(4_000);
  await luca.mouse.up();
  await senna.mouse.up();
  await luca.waitForTimeout(2_000);

  // Both pages have to end up describing the same world.
  const distance = async (page: Page): Promise<number> =>
    Number(
      await page.locator("#opponent-status").getAttribute("data-distance"),
    );
  await expect
    .poll(async () =>
      Math.abs((await distance(luca)) - (await distance(senna))),
    )
    .toBeLessThan(40);

  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Spelen");
    const hearts = await page
      .locator("#own-hearts")
      .evaluate(
        (element) =>
          element.querySelectorAll(".heart:not([data-lost='true'])").length,
      );
    expect(hearts).toBeGreaterThan(0);
  }

  for (const session of sessions) await session.detach();
  await lucaContext.close();
  await sennaContext.close();
});

import { expect, test, type Page } from "@playwright/test";

/**
 * The one journey that needs the adult PIN: two isolated devices pair against a
 * deployed environment and reach the same authoritative match. It is skipped
 * unless `PRODUCTION_ADMIN_PIN` is provided, and it deliberately pairs real
 * device credentials, so it belongs to the pre-release smoke described in the
 * plan. Pairing the physical iPads afterwards replaces these credentials.
 */
const PIN = process.env.PRODUCTION_ADMIN_PIN ?? "";

test.skip(PIN === "", "PRODUCTION_ADMIN_PIN is required for this journey.");

async function pair(page: Page, role: "Luca" | "Senna"): Promise<void> {
  await page.goto("/");
  await page.getByRole("radio", { name: role }).check();
  await page.getByLabel("Beheerpincode").fill(PIN);
  await page.getByRole("button", { name: "Dit apparaat koppelen" }).click();

  // A role that is still linked to an earlier device asks for confirmation, so
  // wait for whichever answer arrives, including a refusal.
  const heading = page.getByRole("heading", { name: `Hallo ${role}!` });
  const replace = page.getByRole("button", {
    name: "Ja, oud apparaat vervangen",
  });
  try {
    await expect(heading.or(replace).first()).toBeVisible({ timeout: 15_000 });
  } catch {
    // Pairing is rate limited to five attempts a minute, so report what the
    // page actually said instead of timing out on an invisible heading.
    const reason = (await page.locator("#pair-message").textContent()) ?? "";
    throw new Error(`pairing ${role} was refused: ${reason}`);
  }
  if (await replace.isVisible()) await replace.click();
  await expect(heading).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#connection-label")).toHaveText("Online", {
    timeout: 20_000,
  });
}

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

test("two devices pair and share one authoritative match on the deployment", async ({
  browser,
}, testInfo) => {
  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();

  await pair(luca, "Luca");
  await pair(senna, "Senna");

  // Each device sees the other one online through the shared room.
  await expect(luca.locator("#peer-status")).toHaveText("Online", {
    timeout: 20_000,
  });
  await expect(senna.locator("#peer-status")).toHaveText("Online", {
    timeout: 20_000,
  });

  // A release room can already hold a chosen world, a paused match, or a
  // running one, so drive whatever state this room is actually in until both
  // devices are playing. That also exercises the deployed resume flow.
  const world = (page: Page) => page.getByRole("button", { name: "Strand" });
  const ready = (page: Page) =>
    page.getByRole("button", { name: /^(Ik ben klaar|Klaar!)$/ });

  for (let step = 0; step < 8; step += 1) {
    const phase = (await luca.locator("#phase-status").textContent())?.trim();
    if (phase === "Spelen") break;
    if (phase === "Aftellen") {
      await luca.waitForTimeout(1_000);
      continue;
    }
    if (phase === "Wereld kiezen") {
      const lucaChooses = await world(luca).isEnabled();
      const chooser = lucaChooses ? luca : senna;
      const confirmer = lucaChooses ? senna : luca;
      await world(chooser).click();
      await expect(world(confirmer)).toHaveAttribute("aria-pressed", "true", {
        timeout: 15_000,
      });
      await confirmer
        .getByRole("button", { name: "Deze wereld is goed" })
        .click();
      continue;
    }
    if (phase === "Klaarmaken" || phase === "Gepauzeerd") {
      // Cosmetics can only be chosen before the first countdown, so only click
      // what this state actually offers.
      for (const [page, cosmetic] of [
        [luca, "Ridder"],
        [senna, "Piraat"],
      ] as const) {
        const option = page.getByRole("button", { name: cosmetic });
        if (await option.isEnabled()) await option.click();
      }
      for (const page of [luca, senna]) {
        if (await ready(page).isEnabled()) await ready(page).click();
      }
      await luca.waitForTimeout(1_500);
      continue;
    }
    // Waiting for the other device, or restoring a connection.
    await luca.waitForTimeout(1_500);
  }

  // The three second countdown is transient, so both devices are checked for
  // the state that matters: the same running match.
  for (const page of [luca, senna]) {
    await expect(page.locator("#phase-status")).toHaveText("Spelen", {
      timeout: 30_000,
    });
    expect(await hearts(page)).toBe(10);
    await expect(page.locator("#weapon-status")).toHaveText("Vuisten");
  }

  // Both players move at the same time and both devices agree they closed in.
  const before = { luca: await distance(luca), senna: await distance(senna) };
  await luca.keyboard.down("ArrowRight");
  await senna.keyboard.down("ArrowLeft");
  await luca.waitForTimeout(1_200);
  await luca.keyboard.up("ArrowRight");
  await senna.keyboard.up("ArrowLeft");
  await expect
    .poll(() => distance(luca), { timeout: 15_000 })
    .toBeLessThan(before.luca);
  await expect
    .poll(() => distance(senna), { timeout: 15_000 })
    .toBeLessThan(before.senna);

  // Remote latency has to stay inside the product budget over the real path.
  const quality = await luca.locator("#quality-status").textContent();
  const milliseconds = Number(/(\d+)\s*ms/.exec(quality ?? "")?.[1] ?? "9999");
  expect(milliseconds).toBeLessThan(350);

  // Nothing awarded damage on its own.
  expect(await hearts(luca)).toBe(10);
  expect(await hearts(senna)).toBe(10);

  await luca.screenshot({ path: testInfo.outputPath("production-luca.png") });
  if (testInfo.project.name === "chromium") {
    await luca.screenshot({ path: "docs/checkpoints/phase-07-production.png" });
  }
  await lucaContext.close();
  await sennaContext.close();
});

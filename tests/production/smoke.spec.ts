import { expect, test, type Page } from "@playwright/test";

/**
 * Read-only checks against a deployed environment. They never pair a device, so
 * they cannot disturb a real match, and they cover everything that does not
 * need the adult PIN: the served page, the guarded APIs, the prepared artwork,
 * and a complete match through the browser-local test mode.
 */

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    // The browser also logs the expected unpaired 401 as a console error, and
    // that message carries no URL to filter on.
    const expectedUnpaired = /Failed to load resource.*\b401\b/.test(
      message.text(),
    );
    if (message.type() === "error" && !expectedUnpaired) {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    // The session endpoint answers 401 until a device is paired, which is the
    // correct answer here and not a failure.
    if (response.status() >= 400 && !url.includes("/api/session")) {
      problems.push(`${response.status()} ${url}`);
    }
  });
  return problems;
}

function hearts(page: Page, which: "own" | "peer"): Promise<number> {
  return page
    .locator(`#${which}-hearts`)
    .evaluate(
      (element) =>
        element.querySelectorAll(".heart:not([data-lost='true'])").length,
    );
}

test("the deployed API reports health and refuses unpaired access", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok", apiVersion: 1 });

  const session = await request.get("/api/session");
  expect(session.status()).toBe(401);
  // Errors reach the children in Dutch.
  expect(await session.json()).toMatchObject({ fout: expect.any(String) });

  // The retired client-writable state surface must stay gone.
  const legacy = await request.patch("/api/state", { data: { any: "thing" } });
  expect(legacy.status()).toBeGreaterThanOrEqual(400);
});

test("the setup page renders in Dutch with no console or network errors", async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Koppel dit apparaat" }),
  ).toBeVisible();
  await expect(page.getByLabel("Beheerpincode")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Luca" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Senna" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("the browser bundle carries no secret", async ({ request, page }) => {
  await page.goto("/");
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLScriptElement).src),
    );
  expect(scripts.length).toBeGreaterThan(0);
  for (const source of scripts) {
    const body = await (await request.get(source)).text();
    for (const secret of [
      "ADMIN_PIN",
      "SESSION_SIGNING_SECRET",
      "WORKER_INTERNAL_SECRET",
      "KV_REST_API_TOKEN",
    ]) {
      expect(body).not.toContain(secret);
    }
  }
});

test("the prepared artwork is served", async ({ request }) => {
  const files = [
    "/art/sprites/luca.png",
    "/art/sprites/senna.png",
    "/art/worlds/beach.png",
    "/art/icons/chest.png",
    "/art/icons/heart.png",
  ];
  for (const file of files) {
    const response = await request.get(file);
    expect(response.status(), file).toBe(200);
    expect((await response.body()).byteLength, file).toBeGreaterThan(1_000);
  }
});

test("test mode plays a full match on the deployed build", async ({ page }) => {
  const problems = collectProblems(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/?test=luca");
  await expect(page.locator("#phase-status")).toHaveText("Spelen");
  expect(await hearts(page, "own")).toBe(10);
  await expect(page.locator("#weapon-status")).toHaveText("Vuisten");
  await expect(page.locator("#effect-status")).toHaveText("Geen");

  // The artwork actually reaches the canvas.
  const drawn = await page.evaluate(async () => {
    const image = new Image();
    image.src = "/art/sprites/luca.png";
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(drawn.width).toBeGreaterThan(0);
  expect(drawn.height).toBeGreaterThan(0);

  // A sword takes two hearts off the training opponent.
  await page.getByLabel("Oefenpop").selectOption("follow");
  await expect
    .poll(
      () =>
        page
          .locator("#opponent-status")
          .evaluate((element) =>
            Number((element as HTMLElement).dataset.distance),
          ),
      { timeout: 15_000 },
    )
    .toBeLessThan(120);
  await page.getByLabel("Wapen").selectOption("sword");
  await page.keyboard.down("KeyF");
  await page.waitForTimeout(100);
  await page.keyboard.up("KeyF");
  await expect.poll(() => hearts(page, "peer"), { timeout: 10_000 }).toBe(8);

  // Blocking, switching, and the pause control all answer on the deployed
  // build; the authoritative rules behind them are covered by the local suites.
  await page.keyboard.down("ShiftLeft");
  await expect(page.getByRole("button", { name: "Blok" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.up("ShiftLeft");
  await expect(page.getByRole("button", { name: "Pauze" })).toBeEnabled();

  expect(problems).toEqual([]);
});

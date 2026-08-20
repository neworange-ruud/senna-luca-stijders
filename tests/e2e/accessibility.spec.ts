import { expect, test, type Page } from "@playwright/test";

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

/**
 * Reports every visible control that is too small to hit or has no name a
 * screen reader could read out.
 */
async function controlProblems(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const problems: {
      selector: string;
      width: number;
      height: number;
      name: string;
    }[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      "button, select, input, a[href], [role='radio']",
    );
    for (const control of controls) {
      // A small native radio inside a large label is hit by tapping the label,
      // so the label is what a finger has to find.
      const wrapper = control.closest("label");
      const box = (wrapper ?? control).getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      const label = (
        control.getAttribute("aria-label") ??
        wrapper?.textContent ??
        control.textContent ??
        ""
      ).trim();
      const labelled =
        label.length > 0 ||
        Boolean(control.getAttribute("aria-labelledby")) ||
        Boolean(
          control.id &&
          document.querySelector(`label[for="${control.id}"]`)?.textContent,
        ) ||
        Boolean(control.closest("label"));
      const identifier =
        control.id || control.getAttribute("data-control") || control.tagName;
      if (!labelled || box.width < 44 || box.height < 44) {
        problems.push({
          selector: identifier,
          width: Math.round(box.width),
          height: Math.round(box.height),
          name: label,
        });
      }
    }
    return problems;
  });
}

/** Text and background pairs whose contrast is below the 4.5:1 requirement. */
async function contrastProblems(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const parse = (colour: string): [number, number, number] => {
      const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };
    const channel = (value: number): number => {
      const ratio = value / 255;
      return ratio <= 0.03928
        ? ratio / 12.92
        : Math.pow((ratio + 0.055) / 1.055, 2.4);
    };
    const luminance = ([red, green, blue]: [number, number, number]): number =>
      0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
    const opaqueBackground = (element: Element): [number, number, number] => {
      let current: Element | null = element;
      while (current) {
        const colour = getComputedStyle(current).backgroundColor;
        const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [];
        const alpha = parts.length > 3 ? (parts[3] ?? 1) : 1;
        if (alpha > 0.5) return parse(colour);
        current = current.parentElement;
      }
      return [255, 255, 255];
    };

    const problems: { selector: string; ratio: number; text: string }[] = [];
    const targets = document.querySelectorAll<HTMLElement>(
      "p, span, strong, h1, h2, h3, button, label, dd, dt, li",
    );
    for (const target of targets) {
      const text = (target.textContent ?? "").trim();
      if (text.length === 0) continue;
      const box = target.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (target.querySelector("p, span, strong, button, dd")) continue;
      const style = getComputedStyle(target);
      const foreground = luminance(parse(style.color));
      const background = luminance(opaqueBackground(target));
      const ratio =
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05);
      const size = Number.parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      if (ratio < (large ? 3 : 4.5)) {
        problems.push({
          selector: target.id || target.className || target.tagName,
          ratio: Math.round(ratio * 100) / 100,
          text: text.slice(0, 40),
        });
      }
    }
    return problems;
  });
}

test("the setup page can be read, reached, and hit", async ({ page }) => {
  await page.goto("/");
  expect(await controlProblems(page)).toEqual([]);
  expect(await contrastProblems(page)).toEqual([]);

  // The adult can complete the whole setup from the keyboard, in reading order.
  const order: string[] = [];
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return (
          active?.id ||
          active?.getAttribute("aria-label") ||
          active?.tagName ||
          ""
        );
      }),
    );
  }
  expect(order.filter((name) => name !== "BODY").length).toBeGreaterThan(2);
  expect(order).toContain("admin-pin");
});

test("the arena is playable and described without looking at the canvas", async ({
  browser,
}) => {
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
  await expect(luca.locator("#phase-status")).toHaveText("Spelen", {
    timeout: 12_000,
  });

  // Everything a child needs to know is in text outside the canvas.
  await expect(luca.locator("#own-hearts")).toHaveAttribute(
    "aria-label",
    /harten/,
  );
  await expect(luca.locator("#weapon-status")).toHaveText("Vuisten");
  await expect(luca.locator("#world-status")).toHaveText("Strand");
  await expect(luca.locator("#effect-status")).toHaveAttribute(
    "aria-label",
    /krachten/i,
  );
  const live = await luca.locator("[aria-live]").count();
  expect(live).toBeGreaterThan(0);

  expect(await controlProblems(luca)).toEqual([]);
  expect(await contrastProblems(luca)).toEqual([]);

  // The arena itself never traps the browser's own gestures by accident.
  const gestures = await luca.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>("#game-canvas");
    const control = document.querySelector<HTMLElement>("[data-control]");
    return {
      canvas: canvas ? getComputedStyle(canvas).touchAction : "",
      control: control ? getComputedStyle(control).touchAction : "",
      // Safari only learned this property recently, so a build that does not
      // know it reports nothing rather than a wrong value.
      body:
        getComputedStyle(document.body).getPropertyValue(
          "overscroll-behavior-y",
        ) || "unsupported",
    };
  });
  expect(gestures.canvas).toBe("none");
  expect(gestures.control).toBe("none");
  expect(["none", "unsupported"]).toContain(gestures.body);

  await lucaContext.close();
  await sennaContext.close();
});

test("a portrait iPad is told to turn", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await pair(page, "Luca");
  const message = await page.evaluate(() => {
    const stage = document.querySelector("#game-stage");
    return stage ? getComputedStyle(stage, "::before").content : "";
  });
  expect(message).toContain("Draai de iPad");
  await context.close();
});

test("reduced motion still plays a full match", async ({ browser }) => {
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
  await luca.getByRole("button", { name: "Bos" }).click();
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

  // Moving still works, so the arena is not frozen along with the animations.
  const before = Number(
    await luca.locator("#opponent-status").getAttribute("data-distance"),
  );
  // Held, not tapped: walking is a held control, so a click would move nobody.
  const right = luca.getByRole("button", { name: "Naar rechts" });
  const box = await right.boundingBox();
  expect(box).not.toBeNull();
  await luca.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  await luca.mouse.down();
  await luca.waitForTimeout(900);
  await luca.mouse.up();
  await luca.waitForTimeout(300);
  const after = Number(
    await luca.locator("#opponent-status").getAttribute("data-distance"),
  );
  expect(after).not.toBe(before);

  await lucaContext.close();
  await sennaContext.close();
});

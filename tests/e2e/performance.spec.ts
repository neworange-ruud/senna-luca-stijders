import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

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

interface FrameReport {
  frames: number;
  seconds: number;
  averageFps: number;
  medianFrameMs: number;
  worstFrameMs: number;
  longFrames: number;
  /** Time the game itself spends in a frame, which is the part we own. */
  ownWorkMsPerFrame: number;
  snapshotParseMs: number;
  heapGrowthMb: number | null;
}

/**
 * Watches real animation frames, and separates the time the game spends from
 * the time the browser spends painting. The split matters: a headless WebKit on
 * a machine without a GPU paints in software and cannot reach the frame rate an
 * iPad reaches, while the work the game does is the same in both.
 */
async function measure(page: Page, seconds: number): Promise<FrameReport> {
  return page.evaluate(async (duration) => {
    const performanceWithMemory = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    const startHeap = performanceWithMemory.memory?.usedJSHeapSize ?? null;

    const raf = window.requestAnimationFrame.bind(window);
    let ownWorkMs = 0;
    let callbacks = 0;
    window.requestAnimationFrame = (handler: FrameRequestCallback) =>
      raf((time) => {
        const started = performance.now();
        handler(time);
        ownWorkMs += performance.now() - started;
        callbacks += 1;
      });

    const parse = JSON.parse.bind(JSON) as (text: string) => unknown;
    let parseMs = 0;
    JSON.parse = (text: string): unknown => {
      const started = performance.now();
      const value = parse(text);
      parseMs += performance.now() - started;
      return value;
    };

    const times: number[] = [];
    const start = performance.now();
    let last = start;
    await new Promise<void>((resolve) => {
      const step = (now: number): void => {
        times.push(now - last);
        last = now;
        if (now - start >= duration * 1_000) {
          resolve();
          return;
        }
        raf(step);
      };
      raf(step);
    });
    window.requestAnimationFrame = raf;
    JSON.parse = parse as typeof JSON.parse;

    const endHeap = performanceWithMemory.memory?.usedJSHeapSize ?? null;
    const sorted = [...times].sort((first, second) => first - second);
    const elapsed = (last - start) / 1_000;
    const round = (value: number): number => Math.round(value * 100) / 100;
    return {
      frames: times.length,
      seconds: round(elapsed),
      averageFps: round(times.length / elapsed),
      medianFrameMs: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
      worstFrameMs: round(sorted[sorted.length - 1] ?? 0),
      longFrames: times.filter((value) => value > 33.4).length,
      ownWorkMsPerFrame: round(ownWorkMs / Math.max(1, callbacks)),
      snapshotParseMs: round(parseMs),
      heapGrowthMb:
        startHeap !== null && endHeap !== null
          ? round((endHeap - startHeap) / (1_024 * 1_024))
          : null,
    };
  }, seconds);
}

test("the arena holds its frame budget while a match is running", async ({
  browser,
}, testInfo) => {
  const device = { viewport: { width: 1180, height: 820 }, hasTouch: true };
  const lucaContext = await browser.newContext(device);
  const sennaContext = await browser.newContext(device);
  const luca = await lucaContext.newPage();
  const senna = await sennaContext.newPage();
  await pair(luca, "Luca");
  await pair(senna, "Senna");

  // The city is the busiest world: rooftops, lifts, cover, and a long street.
  await luca.getByRole("button", { name: "Stad" }).click();
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

  // Keep both children moving so the measurement covers a real fight rather
  // than an idle arena.
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

  const report = await measure(luca, 6);
  await luca.mouse.up();
  await senna.mouse.up();

  const correction = await luca
    .locator("#quality-status")
    .getAttribute("data-correction");
  const summary = { ...report, correction, engine: testInfo.project.name };
  writeFileSync(
    `docs/checkpoints/phase-09-performance-${testInfo.project.name}.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  // The work the game itself does has to leave the whole frame budget free,
  // and this holds in every engine because it is our own code.
  expect(report.ownWorkMsPerFrame).toBeLessThan(8);
  expect(report.snapshotParseMs).toBeLessThan(100);
  // Nothing may accumulate over six seconds of play.
  if (report.heapGrowthMb !== null) {
    expect(report.heapGrowthMb).toBeLessThan(8);
  }

  if (testInfo.project.name === "chromium") {
    // Chromium composites on the GPU here, so the frame rate itself is
    // meaningful: 30 frames per second is the floor and 60 is the target.
    expect(report.averageFps).toBeGreaterThanOrEqual(30);
    expect(report.medianFrameMs).toBeLessThanOrEqual(33.4);
    // Occasional slow frames are normal; a stream of them is not. A shared
    // build runner with two cores and no GPU bursts more than a real machine,
    // and the frame rate the children feel is the median above, so the burst
    // allowance is wider there. The floor on the devices themselves is measured
    // on the devices.
    const burstAllowance = process.env.CI ? 0.3 : 0.1;
    expect(report.longFrames / report.frames).toBeLessThan(burstAllowance);
  }

  await lucaContext.close();
  await sennaContext.close();
});

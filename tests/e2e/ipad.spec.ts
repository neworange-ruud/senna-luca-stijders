import { expect, test } from "@playwright/test";

// The children play on regular 4:3 iPads, which are 1024 by 768 CSS pixels
// once the tablet is on its side. A 16:9 laptop hides both faults below.
test.use({ viewport: { width: 1024, height: 768 } });

test("the arena fits the screen while a hint is showing", async ({
  page,
}, testInfo) => {
  await page.goto("/?test=luca");
  await expect(page.locator("#game-canvas")).toBeVisible();
  // The hint used to sit in the stage's flow, so it only clipped the arena
  // once one appeared. Measuring without a hint on screen proves nothing.
  await expect(page.locator("#hint-line")).toBeVisible();

  const fit = await page.evaluate(() => {
    const stage = document.getElementById("game-stage")!;
    const canvas = document.getElementById("game-canvas")!;
    const status = document.querySelector(".game-hud")!;
    const hint = document.getElementById("hint-line")!;
    return {
      stageOverflow: stage.scrollHeight - stage.clientHeight,
      pageOverflowY: document.documentElement.scrollHeight - innerHeight,
      pageOverflowX: document.documentElement.scrollWidth - innerWidth,
      canvasBelowStage:
        canvas.getBoundingClientRect().bottom -
        stage.getBoundingClientRect().bottom,
      hintUnderStatus:
        hint.getBoundingClientRect().top -
        status.getBoundingClientRect().bottom,
    };
  });

  // Nothing of the arena is cut off, and the page itself never scrolls.
  expect(fit.stageOverflow).toBeLessThanOrEqual(0);
  expect(fit.canvasBelowStage).toBeLessThanOrEqual(0);
  expect(fit.pageOverflowY).toBeLessThanOrEqual(0);
  expect(fit.pageOverflowX).toBeLessThanOrEqual(0);
  // The hint is readable rather than hidden behind the status bar.
  expect(fit.hintUnderStatus).toBeGreaterThanOrEqual(0);

  // The checkpoint shows what a real match looks like, so the test panel that
  // only exists to reach this screen without a second iPad is taken away
  // first. The measurements above kept it, because it makes the fit tighter.
  if (testInfo.project.name === "chromium") {
    await page.evaluate(() => {
      delete document.body.dataset.testMode;
      document.getElementById("test-panel")?.setAttribute("hidden", "");
    });
    await page.screenshot({ path: "docs/checkpoints/phase-10-ipad-fit.png" });
  }
});

test("holding or dragging never selects text during a match", async ({
  page,
}) => {
  await page.goto("/?test=luca");
  await expect(page.locator("#game-canvas")).toBeVisible();

  const styles = await page.evaluate(() => {
    const read = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      // Older iPads only implement the prefixed property, so a build that
      // sets just the standard one reports nothing here. The matching
      // -webkit-touch-callout is not readable outside iOS, so it goes
      // unchecked.
      return {
        userSelect:
          style.getPropertyValue("-webkit-user-select") ||
          style.getPropertyValue("user-select"),
      };
    };
    return {
      canvas: read("#game-canvas"),
      control: read("[data-control]"),
      status: read(".game-hud strong"),
    };
  });
  expect(styles.canvas.userSelect).toBe("none");
  expect(styles.control.userSelect).toBe("none");
  expect(styles.status.userSelect).toBe("none");

  // A drag across the busiest text on screen leaves nothing selected.
  const status = await page.locator(".game-hud strong").first().boundingBox();
  if (!status) throw new Error("The status bar has no box to drag across.");
  await page.mouse.move(status.x + 2, status.y + status.height / 2);
  await page.mouse.down();
  await page.mouse.move(status.x + 400, status.y + status.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  expect(await page.evaluate(() => String(getSelection()))).toBe("");

  // Whatever the gesture, the browser is told no before it starts one.
  const refused = await page.evaluate(() =>
    (["selectstart", "contextmenu", "dragstart"] as const).map((name) => {
      const event = new Event(name, { bubbles: true, cancelable: true });
      document.querySelector(".game-hud strong")!.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(refused).toEqual([true, true, true]);
});

test("the grown-up can still work the pincode field", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#admin-pin")).toBeVisible();
  const selectable = await page.evaluate(() => {
    const style = getComputedStyle(document.getElementById("admin-pin")!);
    return (
      style.getPropertyValue("-webkit-user-select") ||
      style.getPropertyValue("user-select")
    );
  });
  expect(selectable).not.toBe("none");
});

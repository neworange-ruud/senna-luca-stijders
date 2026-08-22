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

test("the browser can no longer be zoomed", async ({ page }) => {
  await page.goto("/?test=luca");
  await expect(page.locator("#game-canvas")).toBeVisible();

  const viewport = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  // Pinned at both ends. An iPad that honours only one of these still cannot
  // end up at a scale the child did not ask for and cannot undo.
  expect(viewport).toContain("maximum-scale=1.0");
  expect(viewport).toContain("minimum-scale=1.0");
  expect(viewport).toContain("user-scalable=no");

  const refused = await page.evaluate(() => {
    // Safari's own pinch and rotate gestures, which arrive whatever the
    // viewport says. The synthetic events stand in for two fingers.
    const gestures = ["gesturestart", "gesturechange", "gestureend"].map(
      (name) => {
        const event = new Event(name, { bubbles: true, cancelable: true });
        document.getElementById("game-canvas")!.dispatchEvent(event);
        return event.defaultPrevented;
      },
    );
    // A trackpad pinch and the keyboard shortcuts reach the same zoom.
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
    });
    window.dispatchEvent(wheel);
    const keys = ["+", "-", "0"].map((key) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        ctrlKey: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    return { gestures, wheel: wheel.defaultPrevented, keys };
  });
  expect(refused.gestures).toEqual([true, true, true]);
  expect(refused.wheel).toBe(true);
  expect(refused.keys).toEqual([true, true, true]);

  // Two fingers dragged on the page are a pan at most, never a zoom, and
  // Safari never grows the text on its own either.
  const styles = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return {
      touchAction: style.touchAction,
      sizeAdjust:
        style.getPropertyValue("-webkit-text-size-adjust") ||
        style.getPropertyValue("text-size-adjust"),
    };
  });
  expect(styles.touchAction).toBe("pan-x pan-y");
  // Text inflation is a thing mobile engines do, so a desktop build may not
  // implement the property that switches it off and reports nothing at all
  // here. It must never report a value other than the one that switches it
  // off; whether it holds on the iPads themselves belongs to the device check.
  expect(["100%", ""]).toContain(styles.sizeAdjust);
});

test("a finger held on the arena is never an offer to share it", async ({
  page,
}) => {
  await page.goto("/?test=luca");
  await expect(page.locator("#game-canvas")).toBeVisible();

  // A canvas is a picture to iOS, and a picture under a resting finger is
  // offered for saving and sharing unless the touch itself is refused.
  const refusedOnArena = await page.evaluate(() => {
    const touch = new Event("touchstart", { bubbles: true, cancelable: true });
    document.getElementById("game-canvas")!.dispatchEvent(touch);
    return touch.defaultPrevented;
  });
  expect(refusedOnArena).toBe(true);

  // The sound and pause buttons still need the browser to turn their tap into
  // a click, so their touches are the exception and must survive.
  const refusedOnHudButton = await page.evaluate(() => {
    const touch = new Event("touchstart", { bubbles: true, cancelable: true });
    document.getElementById("pause-button")!.dispatchEvent(touch);
    return touch.defaultPrevented;
  });
  expect(refusedOnHudButton).toBe(false);

  // If a selection appears anyway, it is taken away again, and the callout bar
  // that carries the share offer goes with it.
  const selected = await page.evaluate(async () => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".game-hud strong")!);
    getSelection()!.addRange(range);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return String(getSelection());
  });
  expect(selected).toBe("");

  // A grown-up still has to be able to select inside the pincode field.
  await page.goto("/");
  await expect(page.locator("#admin-pin")).toBeVisible();
  const pinKept = await page.evaluate(async () => {
    const input = document.getElementById("admin-pin") as HTMLInputElement;
    input.value = "1234";
    input.focus();
    input.setSelectionRange(0, 4);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return input.selectionEnd! - input.selectionStart!;
  });
  expect(pinKept).toBe(4);
});

test("the arena sits centred with sky all around it", async ({ page }) => {
  await page.goto("/?test=luca");
  await expect(page.locator("#game-canvas")).toBeVisible();

  const gaps = await page.evaluate(() => {
    // The test panel exists only so one device can reach this screen without a
    // second iPad, and the screen makes room for it at the top. A real match
    // has no panel, so measuring with one on screen would measure a layout no
    // child ever sees.
    delete document.body.dataset.testMode;
    document.getElementById("test-panel")?.setAttribute("hidden", "");
    const box = document.getElementById("game-stage")!.getBoundingClientRect();
    return {
      left: box.left,
      right: innerWidth - box.right,
      top: box.top,
      bottom: innerHeight - box.bottom,
    };
  });

  // 1.4rem of margin on every side. The frame and its drop shadow need the
  // room; without it the arena runs into the rounded corners of the screen.
  for (const gap of Object.values(gaps)) expect(gap).toBeGreaterThanOrEqual(20);
  // Centred: what is left over is shared equally by the opposite sides.
  expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(1);
});

test("no control sits against the side of the screen", async ({ page }) => {
  await page.goto("/?test=luca");
  await expect(page.locator("#game-canvas")).toBeVisible();

  const reach = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("[data-control]")].map(
      (button) => button.getBoundingClientRect(),
    );
    const widest = Math.max(...boxes.map((box) => box.width));
    return {
      // The room left clear at each end of the row of controls.
      left: Math.min(...boxes.map((box) => box.left)),
      right: innerWidth - Math.max(...boxes.map((box) => box.right)),
      widest,
      // One iPad's controls must all stay on a single row, or the reserved
      // edge has pushed them into a second one over the ground.
      rows: new Set(boxes.map((box) => Math.round(box.bottom))).size,
    };
  });

  // A strip along the right-hand edge of one of the two iPads no longer
  // answers a finger. Two controls' worth of room is kept clear of both ends.
  expect(reach.right).toBeGreaterThanOrEqual(reach.widest * 2);
  expect(reach.left).toBeGreaterThanOrEqual(reach.widest * 2);
  expect(reach.rows).toBe(1);
});

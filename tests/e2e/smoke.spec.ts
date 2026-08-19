import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  const response = await request.post("http://127.0.0.1:8787/debug/reset");
  expect(response.ok()).toBe(true);
});

test("landing page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Senna & Luca Strijders/);
});

test("two WebSockets share one local Durable Object", async ({ page }) => {
  const result = await page.evaluate(async () => {
    function connect(role: "luca" | "senna"): Promise<WebSocket> {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:8787/ws?role=${role}`,
          "game.v1",
        );
        socket.addEventListener("open", () => resolve(socket), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket failed")),
          {
            once: true,
          },
        );
      });
    }

    const first = await connect("luca");
    const presencePromise = new Promise<number>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("No two-player presence message")),
        5_000,
      );
      const onMessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as {
          type: string;
          connections?: number;
        };
        if (message.type === "presence" && message.connections === 2) {
          window.clearTimeout(timeout);
          first.removeEventListener("message", onMessage);
          resolve(message.connections);
        }
      };
      first.addEventListener("message", onMessage);
    });
    const second = await connect("senna");
    const presence = await presencePromise;

    first.close();
    second.close();
    return presence;
  });

  expect(result).toBe(2);
});

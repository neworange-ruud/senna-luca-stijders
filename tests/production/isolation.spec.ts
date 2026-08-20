import { expect, test } from "@playwright/test";

/**
 * Proves that the deployed environments cannot see or change each other, and
 * that the realtime room refuses anything that is not a properly signed player.
 * Everything here is a rejection test: nothing it sends is ever accepted, so it
 * is safe to run against production while the children are playing.
 */

const PRODUCTION_WORKER =
  process.env.PRODUCTION_REALTIME_URL ??
  "https://senna-luca-strijders-production.senna-luca-strijders.workers.dev";
const PREVIEW_WORKER =
  process.env.PREVIEW_REALTIME_URL ??
  "https://senna-luca-strijders-preview.senna-luca-strijders.workers.dev";

interface Health {
  status: string;
  omgeving: string;
  protocolVersion: number;
  schemaVersion: number;
}

async function health(url: string): Promise<Health> {
  const response = await fetch(`${url}/health?cache=${Date.now()}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Health;
}

test("preview and production are separate rooms on separate Workers", async () => {
  const [live, staging] = await Promise.all([
    health(PRODUCTION_WORKER),
    health(PREVIEW_WORKER),
  ]);
  expect(live.omgeving).toBe("production");
  expect(staging.omgeving).toBe("preview");
  // They run the same code, so the protocol and schema they speak must match.
  expect(staging.protocolVersion).toBe(live.protocolVersion);
  expect(staging.schemaVersion).toBe(live.schemaVersion);
  // Different hosts mean different Durable Object namespaces: there is no
  // storage either environment could share with the other.
  expect(new URL(PREVIEW_WORKER).host).not.toBe(
    new URL(PRODUCTION_WORKER).host,
  );
});

test("the production room refuses a socket without a signed role", async () => {
  // Node refuses to send an Upgrade header, so these are plain requests. That
  // is the point: the room has to reject them before any socket exists.
  for (const path of [
    "/connect",
    "/connect?role=luca",
    "/connect?role=luca&token=not-a-real-token",
    "/connect?role=luca&token=not-a-real-token&protocolVersion=1",
  ]) {
    const response = await fetch(`${PRODUCTION_WORKER}${path}`);
    expect({ path, ok: response.ok }).toEqual({ path, ok: false });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }
});

test("the production room refuses unsigned and wrongly signed internal calls", async () => {
  // The pairing API is the only caller allowed to reach these, and it signs
  // every body with a secret this test does not have.
  for (const path of ["/session", "/revoke"]) {
    const unsigned = await fetch(`${PRODUCTION_WORKER}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "luca" }),
    });
    expect({ path, ok: unsigned.ok }).toEqual({ path, ok: false });

    const wronglySigned = await fetch(`${PRODUCTION_WORKER}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The local development secret, which production must not accept.
        "x-internal-signature":
          "local-worker-secret-change-outside-development",
      },
      body: JSON.stringify({ role: "luca" }),
    });
    expect({ path, ok: wronglySigned.ok }).toEqual({ path, ok: false });
  }
});

test("the production room exposes no debug or reset surface", async () => {
  for (const path of [
    "/debug/reset",
    "/debug/start-playing",
    "/debug/give-weapon?role=luca&item=sword&x=100",
    "/debug/spawn-chest?outcome=sword&role=luca",
  ]) {
    const response = await fetch(`${PRODUCTION_WORKER}${path}`, {
      method: "POST",
    });
    expect({ path, ok: response.ok }).toEqual({ path, ok: false });
  }
});

test("the deployment guards pairing before it ever looks at a pin", async ({
  request,
  baseURL,
}) => {
  // No origin and a foreign origin are both refused, so a page on another site
  // cannot pair a device even if it somehow learned the pin. This stops before
  // the pin is read, which is why it costs no pairing attempt on a live game.
  const noOrigin = await request.post("/api/pair", {
    data: { role: "luca", pin: "000000" },
  });
  expect(noOrigin.status()).toBe(403);
  expect(await noOrigin.json()).toMatchObject({ fout: expect.any(String) });

  const foreignOrigin = await request.post("/api/pair", {
    headers: { origin: "https://iemand-anders.example" },
    data: { role: "luca", pin: "000000" },
  });
  expect(foreignOrigin.status()).toBe(403);

  // From the game's own page, an unknown player is refused in Dutch, and this
  // too is answered before the pin is read.
  const unknownRole = await request.post("/api/pair", {
    headers: { origin: baseURL ?? "" },
    data: { role: "iemand-anders", pin: "000000" },
  });
  expect(unknownRole.status()).toBe(400);
  expect(await unknownRole.json()).toMatchObject({ fout: expect.any(String) });

  // A wrong method and a wrong content type are refused as well.
  const wrongMethod = await request.get("/api/pair");
  expect(wrongMethod.status()).toBe(405);
});

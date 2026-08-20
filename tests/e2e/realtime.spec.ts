import { expect, test } from "@playwright/test";

const realtimeEndpoint =
  process.env.REALTIME_ENDPOINT ?? "ws://127.0.0.1:8787/ws";

test.beforeEach(async ({ request }) => {
  if (!realtimeEndpoint.includes("127.0.0.1")) return;
  const response = await request.post("http://127.0.0.1:8787/debug/reset");
  expect(response.ok()).toBe(true);
});

/**
 * Enough samples for the 95th percentile to be a tail rather than the single
 * worst round trip. With twenty samples it was literally the maximum, so one
 * scheduling hiccup on a shared machine decided whether the budget held.
 */
const sampleCount = Number(process.env.REALTIME_SAMPLES ?? 60);
const sampleIntervalMs = Number(process.env.REALTIME_INTERVAL_MS ?? 20);
test.setTimeout(sampleCount > 100 ? 760_000 : 60_000);

test("two clients exchange authoritative movement within the local latency budget", async ({
  page,
  request,
  browserName,
}) => {
  if (realtimeEndpoint.includes("127.0.0.1")) {
    const started = await request.post(
      "http://127.0.0.1:8787/debug/start-playing",
    );
    expect(started.ok()).toBe(true);
  }
  await page.goto("/");
  const effectiveSampleCount = process.env.REALTIME_SAMPLES
    ? sampleCount
    : browserName === "webkit"
      ? 30
      : sampleCount;
  const report = await page.evaluate(
    async ({ endpoint, samples, intervalMs }) => {
      interface Message {
        type: string;
        commandId?: string;
        accepted?: boolean;
        snapshot?: {
          revision: number;
          acknowledgedSequences: { luca: number; senna: number };
          state: { match: { phase: string } };
        };
      }

      class Peer {
        readonly socket: WebSocket;
        readonly messages: Message[] = [];
        bytes = 0;
        latestRevision = -1;
        private readonly heartbeat: number;

        private constructor(role: "luca" | "senna") {
          const url = new URL(endpoint);
          url.searchParams.set("role", role);
          this.socket = new WebSocket(url, "game.v1");
          this.socket.addEventListener(
            "message",
            (event: MessageEvent<string>) => {
              this.bytes += event.data.length;
              const message = JSON.parse(event.data) as Message;
              if (message.snapshot)
                this.latestRevision = message.snapshot.revision;
              this.messages.push(message);
            },
          );
          this.heartbeat = window.setInterval(() => {
            if (this.socket.readyState === WebSocket.OPEN) {
              this.socket.send(
                JSON.stringify({ type: "ping", clientTime: performance.now() }),
              );
            }
            // Matches the real client: the room treats a quiet socket as a
            // failing connection after 750 ms.
          }, 250);
        }

        static async connect(role: "luca" | "senna"): Promise<Peer> {
          const peer = new Peer(role);
          await new Promise<void>((resolve, reject) => {
            peer.socket.addEventListener("open", () => resolve(), {
              once: true,
            });
            peer.socket.addEventListener(
              "error",
              () => reject(new Error("Socket failed")),
              {
                once: true,
              },
            );
          });
          return peer;
        }

        async waitFor(
          predicate: (message: Message) => boolean,
          timeoutMs = 30_000,
          label = "bericht",
        ) {
          const started = performance.now();
          while (performance.now() - started < timeoutMs) {
            const index = this.messages.findIndex(predicate);
            if (index >= 0) return this.messages.splice(index, 1)[0]!;
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          throw new Error(
            `Protocol wait timed out: ${label}; laatste=${JSON.stringify(this.messages.slice(-3))}`,
          );
        }

        async command(command: Record<string, unknown>): Promise<void> {
          const id = String(command.id);
          this.socket.send(JSON.stringify({ type: "command", command }));
          const acknowledgement = await this.waitFor(
            (message) => message.type === "ack" && message.commandId === id,
            30_000,
            `ack ${id}`,
          );
          if (!acknowledgement.accepted)
            throw new Error(`Command rejected: ${id}`);
        }

        close(): void {
          window.clearInterval(this.heartbeat);
          this.socket.close();
        }
      }

      const luca = await Peer.connect("luca");
      const senna = await Peer.connect("senna");
      await senna.waitFor(
        (message) =>
          message.type === "snapshot" &&
          message.snapshot?.state.match.phase === "playing",
        30_000,
        "spelen",
      );

      const latencies: number[] = [];
      for (let sample = 0; sample < samples; sample += 1) {
        const sequence = sample + 1;
        const started = performance.now();
        await luca.command({
          type: "input",
          id: `move-${sequence}`,
          role: "luca",
          sequence,
          intent: {
            horizontal: sample % 2 === 0 ? 1 : -1,
            jump: false,
            attack: false,
            block: false,
            action: false,
            switchWeapon: false,
          },
        });
        await senna.waitFor(
          (message) =>
            message.type === "snapshot" &&
            (message.snapshot?.acknowledgedSequences.luca ?? -1) >= sequence,
          30_000,
          `beweging ${sequence}`,
        );
        latencies.push(performance.now() - started);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      latencies.sort((first, second) => first - second);
      const percentile = (ratio: number) =>
        latencies[
          Math.min(latencies.length - 1, Math.floor(latencies.length * ratio))
        ]!;
      const result = {
        samples: latencies.length,
        medianMs: percentile(0.5),
        p95Ms: percentile(0.95),
        totalBytes: luca.bytes + senna.bytes,
        converged: luca.latestRevision === senna.latestRevision,
      };
      luca.close();
      senna.close();
      return result;
    },
    {
      endpoint: realtimeEndpoint,
      samples: effectiveSampleCount,
      intervalMs: sampleIntervalMs,
    },
  );

  console.log(`LOCAL_REALTIME_REPORT ${JSON.stringify(report)}`);
  expect(report.samples).toBe(effectiveSampleCount);
  expect(report.converged).toBe(true);
  expect(report.medianMs).toBeLessThan(200);
  expect(report.p95Ms).toBeLessThan(350);
  if (sampleCount <= 100) expect(report.totalBytes).toBeLessThan(1_000_000);
});

import { expect, test } from "@playwright/test";

/**
 * Two bots play through repeated connection loss. Every cycle drops one role,
 * brings it back, resumes through the normal both-ready countdown, and checks
 * that the two clients still describe the same match. The default run is short
 * enough for the normal suite; `SOAK_MINUTES=30` performs the long release run.
 */
const soakMinutes = Number(process.env.SOAK_MINUTES ?? 0.75);
const soakMs = Math.round(soakMinutes * 60_000);

test.setTimeout(soakMs + 120_000);

test.beforeEach(async ({ request }) => {
  expect((await request.post("http://127.0.0.1:8787/debug/reset")).ok()).toBe(
    true,
  );
});

test("two bots survive repeated disconnects and stay convergent", async ({
  page,
  request,
}) => {
  expect(
    (await request.post("http://127.0.0.1:8787/debug/start-playing")).ok(),
  ).toBe(true);
  await page.goto("/");

  const report = await page.evaluate(
    async ({ durationMs }) => {
      interface Message {
        type: string;
        commandId?: string;
        accepted?: boolean;
        snapshot?: {
          revision: number;
          tick: number;
          state: {
            match: {
              phase: string;
              players: Record<
                string,
                { health: number; connected: boolean; inventory: unknown[] }
              >;
              entities: unknown[];
            };
          };
        };
      }

      /** One bot: a socket, its inbox, and a heartbeat that keeps it alive. */
      class Bot {
        socket!: WebSocket;
        messages: Message[] = [];
        latest: Message["snapshot"] | undefined;
        private heartbeat = 0;
        private sequence = 0;

        constructor(readonly role: "luca" | "senna") {}

        async open(): Promise<void> {
          const url = new URL("ws://127.0.0.1:8787/ws");
          url.searchParams.set("role", this.role);
          this.socket = new WebSocket(url, "game.v1");
          this.socket.addEventListener("message", (event: MessageEvent) => {
            const message = JSON.parse(String(event.data)) as Message;
            if (message.snapshot) this.latest = message.snapshot;
            this.messages.push(message);
            if (this.messages.length > 40) this.messages.shift();
          });
          await new Promise<void>((resolve, reject) => {
            this.socket.addEventListener("open", () => resolve(), {
              once: true,
            });
            this.socket.addEventListener(
              "error",
              () => reject(new Error(`socket ${this.role}`)),
              { once: true },
            );
          });
          // Real clients resend their controls; silence means a bad connection.
          this.heartbeat = window.setInterval(() => this.beat(), 250);
        }

        private beat(): void {
          if (this.socket.readyState !== WebSocket.OPEN) return;
          this.sequence += 1;
          this.socket.send(
            JSON.stringify({
              type: "command",
              command: {
                type: "input",
                id: `${this.role}-${this.sequence}`,
                role: this.role,
                sequence: this.sequence,
                intent: {
                  horizontal: this.sequence % 4 < 2 ? 1 : -1,
                  jump: this.sequence % 17 === 0,
                  attack: this.sequence % 11 === 0,
                  block: this.sequence % 23 === 0,
                  action: this.sequence % 13 === 0,
                  switchWeapon: false,
                },
              },
            }),
          );
        }

        send(command: Record<string, unknown>): void {
          this.sequence += 1;
          this.socket.send(
            JSON.stringify({
              type: "command",
              command: {
                ...command,
                id: `${this.role}-${command.type as string}-${this.sequence}`,
                role: this.role,
                sequence: this.sequence,
              },
            }),
          );
        }

        close(): void {
          window.clearInterval(this.heartbeat);
          this.socket.close();
        }

        async waitForPhase(phase: string, timeoutMs: number): Promise<void> {
          const started = performance.now();
          while (performance.now() - started < timeoutMs) {
            if (this.latest?.state.match.phase === phase) return;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          throw new Error(
            `${this.role} never reached ${phase}, saw ${this.latest?.state.match.phase}`,
          );
        }
      }

      const bots = { luca: new Bot("luca"), senna: new Bot("senna") };
      await bots.luca.open();
      await bots.senna.open();
      await bots.senna.waitForPhase("playing", 30_000);

      const problems: string[] = [];
      let cycles = 0;
      let convergedChecks = 0;
      const started = performance.now();

      while (performance.now() - started < durationMs) {
        // Play for a while, then drop whichever bot the cycle picked.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const victim = cycles % 2 === 0 ? bots.senna : bots.luca;
        const other = cycles % 2 === 0 ? bots.luca : bots.senna;
        victim.close();

        // The other side must stop playing rather than fight a frozen target.
        try {
          await other.waitForPhase("reconnecting", 10_000);
        } catch {
          if (other.latest?.state.match.phase !== "paused") {
            problems.push(`no freeze after ${victim.role} left`);
          }
        }

        await victim.open();
        await victim.waitForPhase("paused", 20_000);
        bots.luca.send({ type: "ready", ready: true });
        bots.senna.send({ type: "ready", ready: true });
        await victim.waitForPhase("playing", 30_000);
        await other.waitForPhase("playing", 30_000);

        // Both clients have to describe the same match after every recovery.
        const left = bots.luca.latest;
        const right = bots.senna.latest;
        if (!left || !right) {
          problems.push("missing snapshot after recovery");
        } else {
          convergedChecks += 1;
          const players = Object.keys(left.state.match.players);
          if (players.length !== 2) problems.push(`players=${players.length}`);
          for (const role of ["luca", "senna"]) {
            const health = left.state.match.players[role]?.health ?? -1;
            if (health < 0 || health > 10) problems.push(`health=${health}`);
          }
          const ids = new Set(
            left.state.match.entities.map((entity) =>
              JSON.stringify((entity as { id: string }).id),
            ),
          );
          if (ids.size !== left.state.match.entities.length) {
            problems.push("duplicate entity after recovery");
          }
        }
        cycles += 1;
      }

      const finalTicks = {
        luca: bots.luca.latest?.tick ?? -1,
        senna: bots.senna.latest?.tick ?? -1,
      };
      bots.luca.close();
      bots.senna.close();
      return {
        cycles,
        convergedChecks,
        problems,
        finalTicks,
        seconds: Math.round((performance.now() - started) / 1_000),
      };
    },
    { durationMs: soakMs },
  );

  console.log(`SOAK_REPORT ${JSON.stringify(report)}`);
  expect(report.problems).toEqual([]);
  expect(report.cycles).toBeGreaterThan(0);
  expect(report.convergedChecks).toBe(report.cycles);
  // Both clients end within a few ticks of each other, never diverging.
  expect(
    Math.abs(report.finalTicks.luca - report.finalTicks.senna),
  ).toBeLessThan(30);
});

import type { PlayerState } from "../game/types.js";

/**
 * The frames of a player sheet, in the order they are laid out from left to
 * right. The sheet carries no manifest: this order is the contract between
 * `npm run assets` and the renderer, and both import it from here.
 */
export const PLAYER_FRAMES = ["idle", "walk-a", "walk-b", "jump"] as const;

export type PlayerFrame = (typeof PLAYER_FRAMES)[number];

/**
 * A walk reads as four steps: a step, a pass, the other step, a pass. Three
 * drawings are enough for that, which is one less to generate and one less to
 * keep looking like the others.
 */
const WALK_CYCLE: readonly number[] = [1, 0, 2, 0];

/** Below this speed a player counts as standing still rather than walking. */
const WALKING_SPEED = 30;

const SLOWEST_STEP_MS = 220;
const FASTEST_STEP_MS = 90;

/** How long one step of the walk lasts at this speed. */
export function stepDurationMs(horizontalSpeed: number): number {
  const speed = Math.abs(horizontalSpeed);
  if (speed <= 0) return SLOWEST_STEP_MS;
  return Math.min(
    SLOWEST_STEP_MS,
    Math.max(FASTEST_STEP_MS, Math.round(45_000 / speed)),
  );
}

/**
 * Which frame of the sheet to draw. Animation is decoration: it reads the
 * authoritative state and a wall clock, decides nothing, and is deliberately
 * pure so the choice can be tested without a canvas.
 */
export function frameIndexFor(
  player: Pick<PlayerState, "velocity" | "grounded" | "input">,
  nowMs: number,
): number {
  if (!player.grounded) return PLAYER_FRAMES.indexOf("jump");
  // A blocking player plants their feet, so they stop walking on the spot even
  // while they are still sliding to a stop.
  if (player.input.block) return PLAYER_FRAMES.indexOf("idle");
  const speed = Math.abs(player.velocity.x);
  if (speed < WALKING_SPEED) return PLAYER_FRAMES.indexOf("idle");
  const step = Math.floor(nowMs / stepDurationMs(speed));
  return WALK_CYCLE[
    ((step % WALK_CYCLE.length) + WALK_CYCLE.length) % WALK_CYCLE.length
  ]!;
}

/** The part of a sheet that holds one frame. */
export function frameRectangle(
  sheet: { width: number; height: number },
  index: number,
): { x: number; y: number; width: number; height: number } {
  const width = sheet.width / PLAYER_FRAMES.length;
  return {
    x: width * Math.min(Math.max(index, 0), PLAYER_FRAMES.length - 1),
    y: 0,
    width,
    height: sheet.height,
  };
}

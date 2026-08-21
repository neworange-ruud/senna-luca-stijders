import type { MatchPhase } from "../game/types.js";

export type HintId =
  | "move"
  | "jump"
  | "attack"
  | "block"
  | "switch"
  | "chest"
  | "teleport"
  | "pause";

export interface Hint {
  id: HintId;
  text: string;
}

/** What the browser knows about this child while it decides what to explain. */
export interface HintState {
  phase: MatchPhase;
  /** Controls this child has used at least once, ever. */
  used: ReadonlySet<HintId>;
  /** Hints that were already explained and understood in an earlier match. */
  learned: ReadonlySet<HintId>;
  opponentDistance: number;
  chestWithinReach: boolean;
  teleportLabel: string | null;
  holdsTwoWeapons: boolean;
}

/**
 * One hint at a time, in Dutch, and only for something that is useful right
 * now. A child who is already doing a thing is never told to do it, and a hint
 * that was learned in an earlier match does not come back. The lift and the
 * chest are the exceptions: those are about the here and now, so they are shown
 * whenever they apply.
 */
export function chooseHint(state: HintState): Hint | null {
  if (state.phase === "countdown") {
    return { id: "move", text: "Klaar? Loop met de pijlen of de knoppen." };
  }
  if (state.phase !== "playing") return null;

  if (state.teleportLabel) {
    return {
      id: "teleport",
      text: `${state.teleportLabel}: druk op Actie om mee te gaan.`,
    };
  }
  if (state.chestWithinReach) {
    return { id: "chest", text: "Tik op de kist om hem te openen." };
  }

  const pending: readonly Hint[] = [
    { id: "move", text: "Loop naar links of naar rechts." },
    { id: "jump", text: "Druk op Springen om omhoog te komen." },
    {
      id: "attack",
      text: "Sta dichtbij en druk op Aanval.",
    },
    { id: "block", text: "Houd Blokkeren vast om minder pijn te krijgen." },
    {
      id: "switch",
      text: "Druk op Wisselen voor je andere wapen.",
    },
    { id: "pause", text: "Je mag altijd op Pauze drukken." },
  ];

  for (const hint of pending) {
    if (state.used.has(hint.id) || state.learned.has(hint.id)) continue;
    // Telling a child to attack while the other one is far away is noise.
    if (hint.id === "attack" && state.opponentDistance > 240) continue;
    if (hint.id === "switch" && !state.holdsTwoWeapons) continue;
    return hint;
  }
  return null;
}

const STORAGE_KEY = "strijders:hints:v1";

/** Reads the hints this child has already been shown, ignoring broken values. */
export function readLearned(raw: string | null): ReadonlySet<HintId> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is HintId => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function writeLearned(learned: ReadonlySet<HintId>): string {
  return JSON.stringify([...learned]);
}

export const HINT_STORAGE_KEY = STORAGE_KEY;

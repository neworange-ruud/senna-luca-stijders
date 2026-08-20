import { BEACH_ARENA } from "./arenas/beach.js";
import { BOAT_ARENA } from "./arenas/boat.js";
import { CITY_ARENA } from "./arenas/city.js";
import { CONSTRUCTION_ARENA } from "./arenas/construction.js";
import { FOREST_ARENA } from "./arenas/forest.js";
import { SPACE_ARENA } from "./arenas/space.js";
import { CHEST_OUTCOMES } from "./types.js";
import type {
  ArenaDefinition,
  ChestOutcome,
  CosmeticId,
  WorldId,
} from "./types.js";

export interface CosmeticDefinition {
  id: CosmeticId;
  label: string;
  icon: string;
  palette: { primary: string; accent: string };
}

export const COSMETICS: readonly CosmeticDefinition[] = [
  {
    id: "superhero",
    label: "Superheld",
    icon: "S",
    palette: { primary: "#176f9c", accent: "#f5bd34" },
  },
  {
    id: "soldier",
    label: "Soldaat",
    icon: "D",
    palette: { primary: "#4f7048", accent: "#d8ca91" },
  },
  {
    id: "knight",
    label: "Ridder",
    icon: "R",
    palette: { primary: "#66758d", accent: "#d9e3ef" },
  },
  {
    id: "astronaut",
    label: "Astronaut",
    icon: "A",
    palette: { primary: "#f1f2f4", accent: "#8058a6" },
  },
  {
    id: "pirate",
    label: "Piraat",
    icon: "P",
    palette: { primary: "#7c352d", accent: "#e8c369" },
  },
];

/** Dutch names for everything a chest can hold, used in every reveal. */
export const CHEST_LABELS: Readonly<Record<ChestOutcome, string>> = {
  sword: "Zwaard",
  "weak-sword": "Klein zwaard",
  nerf: "Blaster",
  armor: "Schild",
  camouflage: "Camouflage",
  speed: "Snelheid",
};

/** Every world has its own geometry, and its label lives with it. */
export const ARENAS: Readonly<Record<WorldId, ArenaDefinition>> = {
  beach: BEACH_ARENA,
  forest: FOREST_ARENA,
  space: SPACE_ARENA,
  construction: CONSTRUCTION_ARENA,
  city: CITY_ARENA,
  boat: BOAT_ARENA,
};

export const WORLDS: readonly ArenaDefinition[] = Object.values(ARENAS);

/**
 * The arena a match is played in. A match that has not chosen yet, or that
 * carries a world this build no longer knows, falls back to the beach: the
 * simplest of the six, and the one every child has already seen.
 */
export function arenaForWorld(
  world: string | null | undefined,
): ArenaDefinition {
  if (!world) return BEACH_ARENA;
  return ARENAS[world as WorldId] ?? BEACH_ARENA;
}

export function validateContent(): readonly string[] {
  const issues: string[] = [];
  for (const outcome of CHEST_OUTCOMES) {
    if (!CHEST_LABELS[outcome]) {
      issues.push(`Chest outcome has no Dutch label: ${outcome}`);
    }
  }
  if (new Set(COSMETICS.map((item) => item.id)).size !== 5) {
    issues.push("Cosmetic ids must be unique.");
  }
  if (new Set(WORLDS.map((world) => world.id)).size !== 6) {
    issues.push("World ids must be unique.");
  }
  for (const cosmetic of COSMETICS) {
    const keys = Object.keys(cosmetic).sort();
    if (keys.join(",") !== "icon,id,label,palette") {
      issues.push(`Cosmetic contains gameplay data: ${cosmetic.id}`);
    }
  }
  return issues;
}

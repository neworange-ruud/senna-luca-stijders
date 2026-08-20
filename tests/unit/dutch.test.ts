import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CHEST_LABELS, COSMETICS, WORLDS } from "../../src/game/content";
import {
  EFFECT_LABELS,
  EVENT_LABELS,
  OUTCOME_LABELS,
  PHASE_LABELS,
  ROLE_NAMES,
  WEAPON_LABELS,
} from "../../src/game/dutch";
import { CHEST_OUTCOMES } from "../../src/game/types";
import type {
  CombatOutcome,
  EffectId,
  ItemId,
  MatchEventKind,
  MatchPhase,
  PlayerRole,
} from "../../src/game/types";

const PHASES: readonly MatchPhase[] = [
  "waiting",
  "world-selection",
  "ready",
  "countdown",
  "playing",
  "paused",
  "reconnecting",
  "finished",
];
const KINDS: readonly MatchEventKind[] = [
  "melee",
  "throw",
  "shoot",
  "empty",
  "impact",
  "pickup",
  "drop",
  "respawn",
  "chest-announced",
  "chest-landed",
  "chest-claimed",
  "effect-ended",
  "teleport",
];
const OUTCOMES: readonly CombatOutcome[] = [
  "miss",
  "cover",
  "protected",
  "blocked",
  "hit",
];
const WEAPONS: readonly (ItemId | "unarmed")[] = [
  "unarmed",
  "sword",
  "weak-sword",
  "nerf",
];
const EFFECTS: readonly EffectId[] = ["armor", "camouflage", "speed"];
const ROLES: readonly PlayerRole[] = ["luca", "senna"];

/**
 * Words that would give away an untranslated string. They are common enough in
 * English UI text and absent from Dutch, so a hit is a real finding rather than
 * a coincidence.
 */
const ENGLISH_WORDS =
  /\b(loading|error|failed|failure|retry|connected|connecting|disconnected|waiting|ready|start|stop|play|player|score|health|weapon|chest|pause|resume|winner|settings|cancel|close|next|back|unknown|invalid|forbidden|unauthorized)\b/i;

/** Visible text of an HTML document: element text and the labels of controls. */
function visibleStrings(html: string): string[] {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const withoutScripts = withoutComments
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const attributes = [
    ...withoutScripts.matchAll(
      /(?:aria-label|title|placeholder|alt)="([^"]*)"/gi,
    ),
  ].map((match) => match[1] ?? "");
  const text = withoutScripts
    .replace(/<[^>]*>/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("&"));
  return [...attributes, ...text];
}

describe("Dutch catalogue", () => {
  it("names every match phase", () => {
    for (const phase of PHASES) expect(PHASE_LABELS[phase]).toBeTruthy();
    expect(Object.keys(PHASE_LABELS).sort()).toEqual([...PHASES].sort());
  });

  it("names every event kind, outcome, weapon, effect, and role", () => {
    for (const kind of KINDS) expect(EVENT_LABELS[kind]).toBeTruthy();
    expect(Object.keys(EVENT_LABELS).sort()).toEqual([...KINDS].sort());
    for (const outcome of OUTCOMES)
      expect(OUTCOME_LABELS[outcome]).toBeTruthy();
    expect(Object.keys(OUTCOME_LABELS).sort()).toEqual([...OUTCOMES].sort());
    for (const weapon of WEAPONS) expect(WEAPON_LABELS[weapon]).toBeTruthy();
    expect(Object.keys(WEAPON_LABELS).sort()).toEqual([...WEAPONS].sort());
    for (const effect of EFFECTS) expect(EFFECT_LABELS[effect]).toBeTruthy();
    for (const role of ROLES) expect(ROLE_NAMES[role]).toBeTruthy();
  });

  it("names every chest outcome, world, and appearance", () => {
    for (const outcome of CHEST_OUTCOMES) {
      expect(CHEST_LABELS[outcome]).toBeTruthy();
    }
    for (const world of WORLDS) expect(world.label).toBeTruthy();
    for (const cosmetic of COSMETICS) expect(cosmetic.label).toBeTruthy();
  });

  it("uses the same word for a weapon everywhere it is named", () => {
    // A chest that hands out a sword has to call it what the HUD calls it.
    for (const weapon of ["sword", "weak-sword", "nerf"] as const) {
      expect(CHEST_LABELS[weapon]).toBe(WEAPON_LABELS[weapon]);
    }
    for (const effect of EFFECTS) {
      expect(CHEST_LABELS[effect]).toBe(EFFECT_LABELS[effect]);
    }
  });

  it("has no English left in the pages the children see", () => {
    for (const file of ["index.html", "health.html"]) {
      const offenders = visibleStrings(readFileSync(file, "utf8")).filter(
        (line) => ENGLISH_WORDS.test(line),
      );
      expect({ file, offenders }).toEqual({ file, offenders: [] });
    }
  });

  it("has no English left in the catalogue itself", () => {
    const labels = [
      ...Object.values(PHASE_LABELS),
      ...Object.values(EVENT_LABELS),
      ...Object.values(OUTCOME_LABELS),
      ...Object.values(WEAPON_LABELS),
      ...Object.values(EFFECT_LABELS),
      ...Object.values(CHEST_LABELS),
      ...WORLDS.map((world) => world.label),
      ...COSMETICS.map((cosmetic) => cosmetic.label),
    ];
    for (const label of labels) {
      expect(ENGLISH_WORDS.test(label)).toBe(false);
      expect(label.trim()).toBe(label);
    }
  });

  it("keeps every teleport name Dutch and shared by both ends", () => {
    for (const world of WORLDS) {
      for (const teleport of world.teleports) {
        expect(teleport.label).toBeTruthy();
        expect(ENGLISH_WORDS.test(teleport.label)).toBe(false);
        for (const destination of teleport.destinations) {
          const other = world.teleports.find((one) => one.id === destination);
          expect(other?.label).toBe(teleport.label);
        }
      }
    }
  });
});

import { CHEST_LABELS } from "./content.js";
import type {
  ChestOutcome,
  CombatOutcome,
  EffectId,
  ItemId,
  MatchEventKind,
  MatchPhase,
  PlayerRole,
} from "./types.js";

/**
 * Every word the children read lives here or in the catalogue next door, so a
 * new game rule cannot ship with an English label by accident. The tests walk
 * these maps against the types they describe, which is what keeps them
 * complete.
 */
export const PHASE_LABELS: Readonly<Record<MatchPhase, string>> = {
  waiting: "Wachten",
  "world-selection": "Wereld kiezen",
  ready: "Klaarmaken",
  countdown: "Aftellen",
  playing: "Spelen",
  paused: "Gepauzeerd",
  reconnecting: "Verbinding herstellen",
  finished: "Afgelopen",
};

export const ROLE_NAMES: Readonly<Record<PlayerRole, string>> = {
  luca: "Luca",
  senna: "Senna",
};

/** Weapons, including the empty hands a match starts with. */
export const WEAPON_LABELS: Readonly<Record<ItemId | "unarmed", string>> = {
  unarmed: "Vuisten",
  sword: "Zwaard",
  "weak-sword": "Klein zwaard",
  nerf: "Blaster",
};

export const EFFECT_LABELS: Readonly<Record<EffectId, string>> = {
  armor: "Schild",
  camouflage: "Camouflage",
  speed: "Snelheid",
};

/** What happened to an attack, for anything that has to say it out loud. */
export const OUTCOME_LABELS: Readonly<Record<CombatOutcome, string>> = {
  miss: "Mis",
  cover: "Tegen de muur",
  protected: "Nog veilig",
  blocked: "Geblokkeerd",
  hit: "Geraakt",
};

/** A short line per event, used by the reader-friendly match log. */
export const EVENT_LABELS: Readonly<Record<MatchEventKind, string>> = {
  melee: "Aanval",
  throw: "Zwaard gegooid",
  shoot: "Pijltje geschoten",
  empty: "Geen pijltjes meer",
  impact: "Raak",
  pickup: "Wapen opgepakt",
  drop: "Wapen laten vallen",
  respawn: "Opnieuw gestart",
  "chest-announced": "Er komt een kist",
  "chest-landed": "De kist staat er",
  "chest-claimed": "Kist geopend",
  "effect-ended": "Kracht voorbij",
  teleport: "Met de lift",
};

export function chestLabel(outcome: ChestOutcome): string {
  return CHEST_LABELS[outcome];
}

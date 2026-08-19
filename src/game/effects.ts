import { EFFECTS } from "./config.js";
import type {
  EffectId,
  EffectState,
  MatchEvent,
  PlayerState,
} from "./types.js";

/**
 * Effects are pure state on a player. Their timers only advance on ticks the
 * match actually simulates, so a pause or a disconnect freezes them without any
 * extra bookkeeping.
 */
export function createEffect(effectId: EffectId): EffectState {
  if (effectId === "armor") {
    return {
      effectId,
      remainingTicks: null,
      capacity: EFFECTS.armorCapacity,
    };
  }
  return {
    effectId,
    remainingTicks:
      effectId === "camouflage" ? EFFECTS.camouflageTicks : EFFECTS.speedTicks,
    capacity: null,
  };
}

export function hasEffect(player: PlayerState, effectId: EffectId): boolean {
  return player.effects.some((effect) => effect.effectId === effectId);
}

export function effectOf(
  player: PlayerState,
  effectId: EffectId,
): EffectState | null {
  return player.effects.find((effect) => effect.effectId === effectId) ?? null;
}

/** A second helping of the same effect replaces the first one at full value. */
export function applyEffect(player: PlayerState, effectId: EffectId): void {
  player.effects = [
    ...player.effects.filter((effect) => effect.effectId !== effectId),
    createEffect(effectId),
  ];
}

/** Movement multiplier from the player's active effects. */
export function speedMultiplier(player: PlayerState): number {
  return hasEffect(player, "speed") ? EFFECTS.speedFactor : 1;
}

/**
 * Spends armor before the player's hearts. Returns the damage that still gets
 * through, so armor never changes what a weapon is worth, only who pays for it.
 */
export function absorbWithArmor(player: PlayerState, damage: number): number {
  const armor = effectOf(player, "armor");
  if (!armor || armor.capacity === null || damage <= 0) return damage;
  const absorbed = Math.min(armor.capacity, damage);
  const remaining = armor.capacity - absorbed;
  player.effects =
    remaining > 0
      ? player.effects.map((effect) =>
          effect.effectId === "armor"
            ? { ...effect, capacity: remaining }
            : effect,
        )
      : player.effects.filter((effect) => effect.effectId !== "armor");
  return damage - absorbed;
}

/** Counts down timed effects and reports the ones that ran out this tick. */
export function advanceEffects(
  player: PlayerState,
  tick: number,
): readonly MatchEvent[] {
  const ended: MatchEvent[] = [];
  player.effects = player.effects.flatMap((effect) => {
    if (effect.remainingTicks === null) return [effect];
    const remainingTicks = effect.remainingTicks - 1;
    if (remainingTicks > 0) return [{ ...effect, remainingTicks }];
    ended.push({
      id: `${player.role}:effect-ended:${effect.effectId}:${tick}`,
      tick,
      kind: "effect-ended",
      role: player.role,
      target: null,
      item: "unarmed",
      outcome: null,
      damage: 0,
      position: { ...player.position },
      chestOutcome: effect.effectId,
    });
    return [];
  });
  return ended;
}

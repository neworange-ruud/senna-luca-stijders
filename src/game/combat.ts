import { intersects } from "./arena.js";
import { COMBAT, MELEE, NERF, PROJECTILES } from "./config.js";
import { absorbWithArmor } from "./effects.js";
import {
  consumeAmmo,
  removeSelectedItem,
  selectedItem,
  selectedWeapon,
} from "./items.js";
import type {
  ArenaDefinition,
  CombatOutcome,
  EntityState,
  GameState,
  ItemId,
  MatchEvent,
  PlayerRole,
  PlayerState,
  Rectangle,
} from "./types.js";

export type MeleeKind = "unarmed" | "sword" | "weak-sword";

interface PlannedAttack {
  event: MatchEvent;
  projectile: EntityState | null;
}

function meleeProfile(kind: MeleeKind) {
  return kind === "sword"
    ? MELEE.sword
    : kind === "weak-sword"
      ? MELEE.weakSword
      : MELEE.unarmed;
}

export function centerX(player: PlayerState): number {
  return player.position.x + player.size.width / 2;
}

function faces(player: PlayerState, other: PlayerState): boolean {
  return centerX(other) < centerX(player)
    ? player.facing === "left"
    : player.facing === "right";
}

function bodyOf(player: PlayerState): Rectangle {
  return { ...player.position, ...player.size };
}

/**
 * The area a melee attack covers: from the attacker's own centre to `range`
 * beyond the front of their body. Starting at the centre matters because
 * players can move through each other, and an opponent standing on top of you
 * would otherwise be impossible to hit.
 */
function attackRectangle(player: PlayerState, range: number): Rectangle {
  const reach = range + player.size.width / 2;
  return {
    x:
      player.facing === "right"
        ? player.position.x + player.size.width / 2
        : player.position.x + player.size.width / 2 - reach,
    y: player.position.y + 8,
    width: reach,
    height: player.size.height - 16,
  };
}

function coverBetween(
  attacker: PlayerState,
  target: PlayerState,
  arena: ArenaDefinition,
): boolean {
  const attackerCenter = centerX(attacker);
  const targetCenter = centerX(target);
  const corridor: Rectangle = {
    x: Math.min(attackerCenter, targetCenter),
    y: Math.max(attacker.position.y, target.position.y),
    width: Math.abs(targetCenter - attackerCenter),
    height:
      Math.min(
        attacker.position.y + attacker.size.height,
        target.position.y + target.size.height,
      ) - Math.max(attacker.position.y, target.position.y),
  };
  return arena.surfaces.some(
    (surface) => surface.kind === "cover" && intersects(corridor, surface),
  );
}

/**
 * Decides what a single hit does to the target. Respawn protection stops
 * everything; a frontal block removes one heart of damage, so darts and
 * unarmed attacks are stopped completely while a normal sword still gets one
 * heart through. Attacks from behind ignore the block entirely.
 */
export function resolveDamage(
  target: PlayerState,
  attacker: PlayerState,
  damage: number,
  tick: number,
): { outcome: CombatOutcome; damage: number } {
  if (target.invulnerableUntilTick > tick) {
    return { outcome: "protected", damage: 0 };
  }
  const afterBlock =
    target.input.block && faces(target, attacker)
      ? Math.max(0, damage - COMBAT.blockDamageReduction)
      : damage;
  // Armor is spent after blocking and before hearts, so a weapon is always
  // worth the same amount of damage no matter who is wearing what.
  const afterArmor = absorbWithArmor(target, afterBlock);
  return afterArmor > 0
    ? { outcome: "hit", damage: afterArmor }
    : { outcome: "blocked", damage: 0 };
}

function event(
  partial: Pick<MatchEvent, "kind" | "role" | "item"> & Partial<MatchEvent>,
  tick: number,
  position: { x: number; y: number },
): MatchEvent {
  return {
    id: `${partial.role}:${partial.kind}:${tick}`,
    tick,
    target: null,
    outcome: null,
    damage: 0,
    position,
    ...partial,
  };
}

function spawnProjectile(
  state: GameState,
  owner: PlayerState,
  itemId: ItemId,
  ammo: number | null,
): EntityState {
  const profile = PROJECTILES[itemId];
  const number = state.match.nextEntityNumber;
  state.match.nextEntityNumber += 1;
  const direction = owner.facing === "right" ? 1 : -1;
  return {
    id: `${itemId}-shot-${number}`,
    kind: "projectile",
    itemId,
    owner: owner.role,
    position: {
      x:
        direction > 0
          ? owner.position.x + owner.size.width
          : owner.position.x - profile.width,
      y: owner.position.y + owner.size.height / 2 - profile.height / 2,
    },
    velocity: { x: profile.speed * direction, y: 0 },
    size: { width: profile.width, height: profile.height },
    facing: owner.facing,
    ammo,
    expiresAtTick: null,
  };
}

/**
 * Turns one player's held controls into at most one attack for this tick.
 * Melee swings happen on the first tick the control is held; releasing after a
 * long enough hold throws a held sword instead of swinging again.
 */
function planAttack(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  arena: ArenaDefinition,
  tick: number,
): PlannedAttack | null {
  const held = attacker.attackHeldTicks;
  const pressed = attacker.input.attack;
  attacker.attackHeldTicks = pressed ? held + 1 : 0;

  const weapon = selectedWeapon(attacker);
  const isSword = weapon === "sword" || weapon === "weak-sword";
  if (!pressed && isSword && held >= COMBAT.throwChargeTicks) {
    const thrown = removeSelectedItem(attacker);
    if (!thrown) return null;
    return {
      event: event(
        { kind: "throw", role: attacker.role, item: thrown.itemId },
        tick,
        { ...attacker.position },
      ),
      projectile: spawnProjectile(state, attacker, thrown.itemId, null),
    };
  }
  if (!pressed || held > 0 || tick < attacker.nextAttackTick) return null;

  if (weapon === "nerf") {
    const blaster = selectedItem(attacker);
    if (!consumeAmmo(attacker)) {
      return {
        event: event(
          { kind: "empty", role: attacker.role, item: "nerf" },
          tick,
          { ...attacker.position },
        ),
        projectile: null,
      };
    }
    attacker.nextAttackTick = tick + NERF.cooldownTicks;
    return {
      event: event({ kind: "shoot", role: attacker.role, item: "nerf" }, tick, {
        ...attacker.position,
      }),
      projectile: spawnProjectile(
        state,
        attacker,
        "nerf",
        (blaster?.ammo ?? 1) - 1,
      ),
    };
  }

  const kind: MeleeKind = weapon;
  const profile = meleeProfile(kind);
  attacker.nextAttackTick = tick + profile.cooldownTicks;
  const swing = event(
    { kind: "melee", role: attacker.role, item: kind, target: target.role },
    tick,
    { ...attacker.position },
  );
  if (!intersects(attackRectangle(attacker, profile.range), bodyOf(target))) {
    return { event: { ...swing, outcome: "miss" }, projectile: null };
  }
  if (coverBetween(attacker, target, arena)) {
    return { event: { ...swing, outcome: "cover" }, projectile: null };
  }
  const resolved = resolveDamage(target, attacker, profile.damage, tick);
  return { event: { ...swing, ...resolved }, projectile: null };
}

/**
 * Runs both players' attacks for one tick. Every attack is planned against the
 * state at the start of the tick before any damage lands, so two lethal hits on
 * the same tick both count.
 */
export function simulateCombat(
  state: GameState,
  arena: ArenaDefinition,
  tick: number,
): readonly MatchEvent[] {
  const players = state.match.players;
  const planned = [
    planAttack(state, players.luca, players.senna, arena, tick),
    planAttack(state, players.senna, players.luca, arena, tick),
  ].filter((attack): attack is PlannedAttack => attack !== null);

  for (const attack of planned) {
    if (attack.event.damage > 0 && attack.event.target) {
      const target = players[attack.event.target];
      target.health = Math.max(0, target.health - attack.event.damage);
    }
    if (attack.projectile) {
      state.match.entities = [...state.match.entities, attack.projectile];
    }
  }
  return planned.map((attack) => attack.event);
}

function opponentOf(role: PlayerRole): PlayerRole {
  return role === "luca" ? "senna" : "luca";
}

function blocksProjectile(
  entity: EntityState,
  arena: ArenaDefinition,
): boolean {
  const body = { ...entity.position, ...entity.size };
  return arena.surfaces.some(
    (surface) => surface.kind !== "platform" && intersects(body, surface),
  );
}

/**
 * Advances thrown swords and darts. A dart that lands is gone; a sword that
 * lands stays in the arena as a recoverable item until someone picks it up or
 * it returns to its owner.
 */
export function simulateProjectiles(
  state: GameState,
  arena: ArenaDefinition,
  tick: number,
  seconds: number,
): readonly MatchEvent[] {
  const events: MatchEvent[] = [];
  const surviving: EntityState[] = [];
  for (const entity of state.match.entities) {
    if (entity.kind !== "projectile") {
      surviving.push(entity);
      continue;
    }
    const moved: EntityState = {
      ...entity,
      position: {
        x: entity.position.x + entity.velocity.x * seconds,
        y: entity.position.y + entity.velocity.y * seconds,
      },
    };
    const body = { ...moved.position, ...moved.size };
    const targetRole = moved.owner ? opponentOf(moved.owner) : null;
    const target = targetRole ? state.match.players[targetRole] : null;
    if (target && moved.owner && intersects(body, bodyOf(target))) {
      const resolved = resolveDamage(
        target,
        state.match.players[moved.owner],
        PROJECTILES[moved.itemId].damage,
        tick,
      );
      target.health = Math.max(0, target.health - resolved.damage);
      events.push(
        event(
          {
            kind: "impact",
            role: moved.owner,
            item: moved.itemId,
            target: targetRole,
            ...resolved,
          },
          tick,
          { ...moved.position },
        ),
      );
      if (moved.itemId !== "nerf") {
        surviving.push(dropped(moved, tick));
      }
      continue;
    }
    const outOfBounds =
      moved.position.x + moved.size.width < arena.bounds.x ||
      moved.position.x > arena.bounds.x + arena.bounds.width ||
      moved.position.y > arena.fallBoundaryY;
    if (blocksProjectile(moved, arena) || outOfBounds) {
      events.push(
        event(
          {
            kind: "impact",
            role: moved.owner ?? "luca",
            item: moved.itemId,
            outcome: outOfBounds ? "miss" : "cover",
          },
          tick,
          { ...moved.position },
        ),
      );
      if (moved.itemId !== "nerf" && !outOfBounds) {
        surviving.push(dropped(moved, tick));
      } else if (moved.itemId !== "nerf") {
        // A sword thrown off the arena is unreachable, so it returns at once.
        surviving.push({
          ...dropped(moved, tick),
          expiresAtTick: tick,
          position: { ...moved.position, y: arena.fallBoundaryY },
        });
      }
      continue;
    }
    surviving.push(moved);
  }
  state.match.entities = surviving;
  return events;
}

function dropped(entity: EntityState, tick: number): EntityState {
  return {
    ...entity,
    kind: "dropped-item",
    velocity: { x: 0, y: 0 },
    expiresAtTick: tick + COMBAT.droppedReturnTicks,
  };
}

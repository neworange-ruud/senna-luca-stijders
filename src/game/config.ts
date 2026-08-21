export const TICK_RATE = 30;
export const TICK_SECONDS = 1 / TICK_RATE;
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const RESPAWN_PROTECTION_TICKS = Math.round(1.5 * TICK_RATE);

/** Converts a tuned millisecond value into whole simulation ticks. */
export function ticks(milliseconds: number): number {
  return Math.round((milliseconds / 1_000) * TICK_RATE);
}

export const MOVEMENT = {
  runSpeed: 360,
  groundAcceleration: 2_400,
  airAcceleration: 1_000,
  jumpImpulse: 760,
  gravity: 1_900,
  maximumFallSpeed: 1_200,
  playerWidth: 64,
  playerHeight: 96,
} as const;

export const MELEE = {
  unarmed: { range: 48, damage: 1, cooldownTicks: ticks(700) },
  sword: { range: 90, damage: 2, cooldownTicks: ticks(650) },
  weakSword: { range: 64, damage: 1, cooldownTicks: ticks(500) },
} as const;

export const COMBAT = {
  /** Holding attack this long and then releasing throws a held sword. */
  throwChargeTicks: ticks(500),
  /** Blocking a frontal attack removes this much damage; rear attacks bypass it. */
  blockDamageReduction: 1,
  /** Blocking slows movement by 40 percent. */
  blockSpeedFactor: 0.6,
  pickupRange: 56,
  /** An unclaimed thrown weapon returns to its owner after eight active seconds. */
  droppedReturnTicks: 8 * TICK_RATE,
  /** Feedback events older than this are pruned so a reconnect cannot replay them. */
  eventRetentionTicks: ticks(1_500),
  maximumEvents: 24,
} as const;

export const PROJECTILES = {
  sword: { speed: 900, damage: 2, width: 72, height: 20 },
  "weak-sword": { speed: 900, damage: 1, width: 52, height: 16 },
  nerf: { speed: 1_150, damage: 1, width: 30, height: 12 },
} as const;

export const NERF = {
  ammo: 6,
  cooldownTicks: ticks(450),
} as const;

export const CHESTS = {
  /** A landing is announced this long before the chest can be claimed. */
  announceTicks: 2 * TICK_RATE,
  /** Active seconds from the start of play to the first announcement. */
  firstAnnouncementTicks: 8 * TICK_RATE,
  /** Active seconds between later announcements. */
  intervalTicks: 12 * TICK_RATE,
  /** Announced and landed chests together may never exceed this. */
  maximumActive: 2,
  claimRange: 72,
  /**
   * How far outside the chest a tap still counts as meaning that chest. A child
   * aims at the picture rather than at the collision box, and the picture bobs.
   */
  tapTolerance: 28,
  /**
   * A player must trail by at least this many hearts for a scheduled chest to
   * count towards the recovery rule.
   */
  recoveryHeartGap: 3,
  /** The third consecutive eligible chest is replaced by a recovery chest. */
  recoveryCount: 3,
} as const;

export const TELEPORT = {
  /** Standing this close to a lift is close enough to use it. */
  range: 72,
  /** A lift will not take the same player again this soon. */
  cooldownTicks: ticks(1_500),
  /**
   * Tried in order when somebody is standing in the exit. The first free spot
   * wins, so an arrival never lands inside a wall or on top of a player.
   */
  arrivalOffsets: [0, 96, -96, 192, -192] as const,
} as const;

export const EFFECTS = {
  /** Armor soaks up this many damage points and then disappears. */
  armorCapacity: 3,
  camouflageTicks: 8 * TICK_RATE,
  speedTicks: 8 * TICK_RATE,
  /** Speed adds a quarter to the run speed. */
  speedFactor: 1.25,
} as const;

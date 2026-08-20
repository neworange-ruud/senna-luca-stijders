export const GAME_SCHEMA_VERSION = 7 as const;
export const GAME_PROTOCOL_VERSION = 1 as const;

export type PlayerRole = "luca" | "senna";
export type Facing = "left" | "right";
export type MatchPhase =
  | "waiting"
  | "world-selection"
  | "ready"
  | "countdown"
  | "playing"
  | "paused"
  | "reconnecting"
  | "finished";

export interface Vector {
  x: number;
  y: number;
}

export interface Rectangle extends Vector {
  width: number;
  height: number;
}

export interface ArenaSurface extends Rectangle {
  id: string;
  kind: "floor" | "platform" | "cover";
}

export interface ArenaPoint extends Vector {
  id: string;
  surfaceId: string;
}

export interface TeleportDefinition extends ArenaPoint {
  /** Shown next to the teleport so a child can see where it leads. */
  label: string;
  destinations: readonly string[];
}

export interface ArenaDefinition {
  id: string;
  label: string;
  bounds: Rectangle;
  fallBoundaryY: number;
  surfaces: readonly ArenaSurface[];
  spawns: Readonly<Record<PlayerRole, readonly ArenaPoint[]>>;
  chestPoints: readonly ArenaPoint[];
  teleports: readonly TeleportDefinition[];
}

export type CosmeticId =
  "superhero" | "soldier" | "knight" | "astronaut" | "pirate";
export type WorldId =
  "beach" | "forest" | "space" | "construction" | "city" | "boat";
export type ItemId = "sword" | "weak-sword" | "nerf";
export type EffectId = "armor" | "camouflage" | "speed";

export interface ItemState {
  id: string;
  itemId: ItemId;
  owner: PlayerRole | null;
  ammo: number | null;
}

export type CombatOutcome = "miss" | "cover" | "protected" | "blocked" | "hit";

export type MatchEventKind =
  | "melee"
  | "throw"
  | "shoot"
  | "empty"
  | "impact"
  | "pickup"
  | "drop"
  | "respawn"
  | "chest-announced"
  | "chest-landed"
  | "chest-claimed"
  | "effect-ended"
  | "teleport";

/**
 * One authoritative thing that happened on a tick. Events are what the browser
 * turns into hit, block, and pickup feedback; they never carry authority
 * themselves, and they are pruned so a reconnecting client cannot replay them.
 */
export interface MatchEvent {
  id: string;
  tick: number;
  kind: MatchEventKind;
  role: PlayerRole;
  target: PlayerRole | null;
  item: ItemId | "unarmed";
  outcome: CombatOutcome | null;
  damage: number;
  position: Vector;
  /** What a chest turned out to hold, for the reveal in the browser. */
  chestOutcome?: ChestOutcome;
}

/** Everything a chest can contain. The base bag holds one of each. */
export type ChestOutcome = ItemId | EffectId;

export const CHEST_OUTCOMES: readonly ChestOutcome[] = [
  "sword",
  "weak-sword",
  "nerf",
  "armor",
  "camouflage",
  "speed",
];

export interface ChestState {
  id: string;
  pointId: string;
  position: Vector;
  outcome: ChestOutcome;
  /** Tick the announcement started; the chest is only claimable once landed. */
  announcedAtTick: number;
  landsAtTick: number;
  /** True when the eligible-recovery rule replaced a scheduled bag draw. */
  recovery: boolean;
}

export interface ChestScheduleState {
  /** Active tick at which the next announcement starts. */
  nextAnnouncementTick: number;
  /** Remaining outcomes of the current base bag, refilled when empty. */
  bag: readonly ChestOutcome[];
  /** Consecutive scheduled chests while one player trailed far enough. */
  recoveryCounter: number;
  /** Alternates so two recovery chests never hold the same help. */
  nextRecovery: "armor" | "speed";
}

export interface EffectState {
  effectId: EffectId;
  remainingTicks: number | null;
  capacity: number | null;
}

export interface InputIntent {
  horizontal: -1 | 0 | 1;
  jump: boolean;
  attack: boolean;
  block: boolean;
  action: boolean;
  switchWeapon: boolean;
}

export interface PlayerState {
  role: PlayerRole;
  connected: boolean;
  ready: boolean;
  cosmetic: CosmeticId | null;
  position: Vector;
  velocity: Vector;
  size: { width: number; height: number };
  facing: Facing;
  grounded: boolean;
  health: number;
  invulnerableUntilTick: number;
  nextAttackTick: number;
  /** Ticks the attack control has been held, used for the sword throw charge. */
  attackHeldTicks: number;
  /**
   * Set when the attack control was pressed since the last simulated tick. A
   * quick tap can start and end inside one tick, and losing it would make the
   * game feel broken on a touchscreen, so the press is remembered until a tick
   * consumes it.
   */
  attackQueued: boolean;
  /** The same memory for the Action control, which claims chests and rides lifts. */
  actionQueued: boolean;
  /** The tick from which this player may use a teleport again. */
  teleportReadyTick: number;
  /** -1 selects unarmed combat, otherwise the index of an inventory slot. */
  selectedSlot: number;
  lastProcessedSequence: number;
  input: InputIntent;
  inventory: readonly ItemState[];
  effects: readonly EffectState[];
}

export interface LobbyState {
  chooser: PlayerRole;
  selectedWorld: WorldId | null;
  worldConfirmed: boolean;
  completedMatches: number;
}

export interface EntityState {
  id: string;
  kind: "projectile" | "chest" | "dropped-item";
  itemId: ItemId;
  owner: PlayerRole | null;
  position: Vector;
  velocity: Vector;
  size: { width: number; height: number };
  facing: Facing;
  ammo: number | null;
  /** Tick at which an unclaimed item returns to its owner, when it has one. */
  expiresAtTick: number | null;
}

export interface MatchState {
  phase: MatchPhase;
  tick: number;
  phaseStartedTick: number;
  countdownEndsTick: number | null;
  resumeTarget: "playing" | null;
  pausedBy: PlayerRole | null;
  /**
   * Why the match is paused. A player asked for it, or a connection went quiet;
   * the browser explains the two differently.
   */
  pauseReason: "player" | "connection" | null;
  winner: PlayerRole | null;
  arenaId: WorldId | null;
  randomState: number;
  nextEntityNumber: number;
  players: Record<PlayerRole, PlayerState>;
  entities: readonly EntityState[];
  events: readonly MatchEvent[];
  chests: readonly ChestState[];
  chestSchedule: ChestScheduleState;
}

export interface GameState {
  schemaVersion: typeof GAME_SCHEMA_VERSION;
  lobby: LobbyState;
  match: MatchState;
  processedCommandIds: readonly string[];
}

export interface GameSnapshot {
  schemaVersion: typeof GAME_SCHEMA_VERSION;
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  revision: number;
  tick: number;
  acknowledgedSequences: Record<PlayerRole, number>;
  state: GameState;
}

export interface InputCommand {
  type: "input";
  id: string;
  role: PlayerRole;
  sequence: number;
  intent: InputIntent;
}

export interface ReadyCommand {
  type: "ready";
  id: string;
  role: PlayerRole;
  sequence: number;
  ready: boolean;
}

export interface PauseCommand {
  type: "pause";
  id: string;
  role: PlayerRole;
  sequence: number;
}

export interface SelectWorldCommand {
  type: "select-world";
  id: string;
  role: PlayerRole;
  sequence: number;
  world: WorldId;
}

export interface ConfirmWorldCommand {
  type: "confirm-world";
  id: string;
  role: PlayerRole;
  sequence: number;
}

export interface RematchCommand {
  type: "rematch";
  id: string;
  role: PlayerRole;
  sequence: number;
}

export interface SelectCosmeticCommand {
  type: "select-cosmetic";
  id: string;
  role: PlayerRole;
  sequence: number;
  cosmetic: CosmeticId;
}

export type GameCommand =
  | InputCommand
  | ReadyCommand
  | PauseCommand
  | RematchCommand
  | SelectWorldCommand
  | ConfirmWorldCommand
  | SelectCosmeticCommand;

export type GameErrorCode =
  | "INVALID_MESSAGE"
  | "PROTOCOL_MISMATCH"
  | "UNAUTHORIZED"
  | "DUPLICATE_COMMAND"
  | "STALE_SEQUENCE"
  | "INVALID_PHASE"
  | "INVALID_ARENA";

export interface GameError {
  code: GameErrorCode;
  messageKey: string;
  details?: Readonly<Record<string, string | number>>;
}

export const EMPTY_INPUT: InputIntent = {
  horizontal: 0,
  jump: false,
  attack: false,
  block: false,
  action: false,
  switchWeapon: false,
};

export function isPlayerRole(value: unknown): value is PlayerRole {
  return value === "luca" || value === "senna";
}

function isWorldId(value: unknown): value is WorldId {
  return ["beach", "forest", "space", "construction", "city", "boat"].includes(
    value as WorldId,
  );
}

function isCosmeticId(value: unknown): value is CosmeticId {
  return ["superhero", "soldier", "knight", "astronaut", "pirate"].includes(
    value as CosmeticId,
  );
}

function isInputIntent(value: unknown): value is InputIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<InputIntent>;
  return (
    (intent.horizontal === -1 ||
      intent.horizontal === 0 ||
      intent.horizontal === 1) &&
    typeof intent.jump === "boolean" &&
    typeof intent.attack === "boolean" &&
    typeof intent.block === "boolean" &&
    typeof intent.action === "boolean" &&
    typeof intent.switchWeapon === "boolean"
  );
}

export function parseGameCommand(value: unknown): GameCommand | GameError {
  if (!value || typeof value !== "object") {
    return { code: "INVALID_MESSAGE", messageKey: "fout.ongeldigBericht" };
  }

  const command = value as Partial<GameCommand>;
  if (
    typeof command.id !== "string" ||
    command.id.length < 1 ||
    command.id.length > 80 ||
    !isPlayerRole(command.role) ||
    !Number.isSafeInteger(command.sequence) ||
    (command.sequence ?? -1) < 0
  ) {
    return { code: "INVALID_MESSAGE", messageKey: "fout.ongeldigBericht" };
  }

  if (command.type === "input" && isInputIntent(command.intent)) {
    return command as InputCommand;
  }
  if (command.type === "ready" && typeof command.ready === "boolean") {
    return command as ReadyCommand;
  }
  if (command.type === "pause") {
    return command as PauseCommand;
  }
  if (command.type === "rematch") {
    return command as RematchCommand;
  }
  if (command.type === "select-world" && isWorldId(command.world)) {
    return command as SelectWorldCommand;
  }
  if (command.type === "confirm-world") {
    return command as ConfirmWorldCommand;
  }
  if (command.type === "select-cosmetic" && isCosmeticId(command.cosmetic)) {
    return command as SelectCosmeticCommand;
  }

  return { code: "INVALID_MESSAGE", messageKey: "fout.ongeldigBericht" };
}

export function isGameError(
  value: GameCommand | GameError,
): value is GameError {
  return "code" in value;
}

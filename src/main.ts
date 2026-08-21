import "./style.css";
import { AudioEngine } from "./client/audio.js";
import { CanvasRenderer } from "./client/canvas-renderer.js";
import { InputMapper, type ControlAction } from "./client/input-mapper.js";
import type { MatchSession } from "./client/match-session.js";
import { PracticeSession } from "./client/practice-session.js";
import { RealtimeClient } from "./client/realtime-client.js";
import {
  PRACTICE_BEHAVIOURS,
  PRACTICE_BEHAVIOUR_LABELS,
  type PracticeBehaviour,
} from "./game/practice.js";
import {
  arenaForWorld,
  CHEST_LABELS,
  COSMETICS,
  WORLDS,
} from "./game/content.js";
import { PHASE_LABELS, WEAPON_LABELS } from "./game/dutch.js";
import {
  chooseHint,
  HINT_STORAGE_KEY,
  readLearned,
  writeLearned,
  type HintId,
} from "./client/hints.js";
import { teleportUnderPlayer } from "./game/teleports.js";
import { TICK_RATE } from "./game/config.js";
import { HEARTBEAT_INTERVAL_MS } from "./game/connection.js";
import { selectedItem, selectedWeapon } from "./game/items.js";
import { GAME_PROTOCOL_VERSION, GAME_SCHEMA_VERSION } from "./game/types.js";
import type {
  GameCommand,
  GameSnapshot,
  ItemId,
  MatchPhase,
  PlayerRole,
  PlayerState,
} from "./game/types.js";

interface SessionResponse {
  role: PlayerRole;
  token: string;
  realtimeUrl: string;
}

const loadingView = document.querySelector<HTMLElement>("#loading-view")!;
const setupView = document.querySelector<HTMLElement>("#setup-view")!;
const playerView = document.querySelector<HTMLElement>("#player-view")!;
const pairForm = document.querySelector<HTMLFormElement>("#pair-form")!;
const pairMessage = document.querySelector<HTMLElement>("#pair-message")!;
const replacePanel = document.querySelector<HTMLElement>("#replace-panel")!;
const replaceButton =
  document.querySelector<HTMLButtonElement>("#replace-button")!;
const connection = document.querySelector<HTMLElement>("#connection")!;
const connectionLabel =
  document.querySelector<HTMLElement>("#connection-label")!;
const testPanel = document.querySelector<HTMLElement>("#test-panel")!;
const testRoleSelect = document.querySelector<HTMLSelectElement>("#test-role")!;
const testBehaviourSelect =
  document.querySelector<HTMLSelectElement>("#test-behaviour")!;
const testRestartButton =
  document.querySelector<HTMLButtonElement>("#test-restart")!;
const testWeaponSelect =
  document.querySelector<HTMLSelectElement>("#test-weapon")!;
const testModeRole = new URLSearchParams(location.search).get("test");
const testMode = testModeRole !== null;
let pendingReplacement: { role: PlayerRole; pin: string } | null = null;
let realtime: MatchSession | null = null;
let practice: PracticeSession | null = null;
let activeRole: PlayerRole | null = null;
let activeSnapshot: GameSnapshot | null = null;
let commandSequence = 0;
const cosmeticOptions =
  document.querySelector<HTMLElement>("#cosmetic-options")!;
const worldOptions = document.querySelector<HTMLElement>("#world-options")!;
const chooserMessage = document.querySelector<HTMLElement>("#chooser-message")!;
const confirmWorld =
  document.querySelector<HTMLButtonElement>("#confirm-world")!;
const readyButton = document.querySelector<HTMLButtonElement>("#ready-button")!;
const lobbyPanel = document.querySelector<HTMLElement>("#lobby-panel")!;
const gameStage = document.querySelector<HTMLElement>("#game-stage")!;
const gameCanvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const ownHearts = document.querySelector<HTMLElement>("#own-hearts")!;
const peerHearts = document.querySelector<HTMLElement>("#peer-hearts")!;
const qualityStatus = document.querySelector<HTMLElement>("#quality-status")!;
const opponentStatus = document.querySelector<HTMLElement>("#opponent-status")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause-button")!;
const protectionStatus =
  document.querySelector<HTMLElement>("#protection-status")!;
const weaponStatus = document.querySelector<HTMLElement>("#weapon-status")!;
const stageOverlay = document.querySelector<HTMLElement>("#stage-overlay")!;
const overlayEyebrow = document.querySelector<HTMLElement>("#overlay-eyebrow")!;
const overlayTitle = document.querySelector<HTMLElement>("#overlay-title")!;
const overlayMessage = document.querySelector<HTMLElement>("#overlay-message")!;
const overlayStatus = document.querySelector<HTMLElement>("#overlay-status")!;
const overlayAction =
  document.querySelector<HTMLButtonElement>("#overlay-action")!;
const effectStatus = document.querySelector<HTMLElement>("#effect-status")!;
const worldStatus = document.querySelector<HTMLElement>("#world-status")!;
const hintLine = document.querySelector<HTMLElement>("#hint-line")!;
const hintText = document.querySelector<HTMLElement>("#hint-text")!;
const effectsToggle =
  document.querySelector<HTMLButtonElement>("#effects-toggle")!;
const musicToggle = document.querySelector<HTMLButtonElement>("#music-toggle")!;
const audio = new AudioEngine();
const inputMapper = new InputMapper();
let renderer: CanvasRenderer | null = null;

function show(view: "loading" | "setup" | "player"): void {
  loadingView.hidden = view !== "loading";
  setupView.hidden = view !== "setup";
  playerView.hidden = view !== "player";
}

function setConnection(state: string, label: string): void {
  connection.dataset.state = state;
  connectionLabel.textContent = label;
}

let soundedPhase: MatchPhase | null = null;
/**
 * Set while a pause has been asked for but has not taken effect yet. Without
 * it the next snapshot, which still says the match is running, would put the
 * button back to "Pauze" and the child would think the tap did nothing.
 */
let pauseRequested = false;

/**
 * Pausing and counting down are phases rather than events, so their sound is
 * played when the phase the browser is showing changes. Gameplay sounds still
 * come from authoritative events only.
 */
function playPhaseSound(phase: MatchPhase): void {
  if (phase === soundedPhase) return;
  soundedPhase = phase;
  if (phase === "paused") audio.play("pause");
  if (phase === "countdown") audio.play("countdown");
  if (phase === "playing") audio.play("start");
}

function phaseLabel(phase: GameSnapshot["state"]["match"]["phase"]): string {
  return PHASE_LABELS[phase];
}

function attachSession(role: PlayerRole, session: MatchSession): void {
  activeRole = role;
  show("player");
  const name = role === "luca" ? "Luca" : "Senna";
  const peerRole = role === "luca" ? "senna" : "luca";
  document.querySelector("#player-title")!.textContent = `Hallo ${name}!`;
  document.querySelector("#identity-badge")!.textContent = name[0]!;
  realtime?.stop();
  renderer?.stop();
  activeSnapshot = null;
  renderer = new CanvasRenderer(gameCanvas, role);
  renderer.start();
  realtime = session;
  realtime.onMetrics((metrics) => {
    const connected = metrics.state === "connected";
    setConnection(
      connected ? "online" : metrics.state,
      connected ? (testMode ? "Testmodus" : "Online") : "Verbinden...",
    );
    const latency = metrics.roundTripMilliseconds;
    qualityStatus.textContent = testMode
      ? "Testmodus"
      : latency === null
        ? "Meten..."
        : latency < 120
          ? `Goed · ${Math.round(latency)} ms`
          : latency < 220
            ? `Matig · ${Math.round(latency)} ms`
            : `Traag · ${Math.round(latency)} ms`;
  });
  realtime.onSnapshot((snapshot) => {
    // A snapshot from a different schema means this page and the server no
    // longer agree about the rules. Stop rather than show a wrong match.
    if (
      snapshot.schemaVersion !== GAME_SCHEMA_VERSION ||
      snapshot.protocolVersion !== GAME_PROTOCOL_VERSION
    ) {
      divergence =
        "Het spel op dit apparaat is anders dan op de server. Laad het spel opnieuw.";
      realtime?.stop();
      renderOverlay(snapshot);
      return;
    }
    activeSnapshot = snapshot;
    commandSequence = Math.max(
      commandSequence,
      snapshot.acknowledgedSequences[role],
    );
    const own = snapshot.state.match.players[role];
    const peer = snapshot.state.match.players[peerRole];
    document.querySelector("#own-status")!.textContent = own.connected
      ? "Online"
      : "Offline";
    document.querySelector("#peer-status")!.textContent = peer.connected
      ? "Online"
      : "Offline";
    document.querySelector("#phase-status")!.textContent = phaseLabel(
      snapshot.state.match.phase,
    );
    document.querySelector("#game-status")!.textContent = peer.connected
      ? "Jullie zijn allebei verbonden."
      : "Wachten op de andere speler...";
    playPhaseSound(snapshot.state.match.phase);
    renderLobby(snapshot);
    // Background pages get their timers throttled, so the heartbeat also rides
    // on incoming snapshots: those are network events and keep arriving.
    if (Date.now() - lastInputSentAt >= HEARTBEAT_INTERVAL_MS) beat();
    const update = renderer?.update(snapshot);
    qualityStatus.dataset.correction = `${Math.round(
      update?.correctionPixels ?? 0,
    )} px correctie`;
    if (update) audio.playEvents(update.events);
  });
  realtime.onError((error) => {
    // A refused pause has to release the button, or the child is left looking
    // at a request that is never going to happen.
    pauseRequested = false;
    setConnection("offline", error.message);
  });
  realtime.start();
}

function displaySession(session: SessionResponse): void {
  attachSession(
    session.role,
    new RealtimeClient(session.realtimeUrl, session.role, session.token),
  );
}

function sendCommand(payload: Record<string, unknown>): number | null {
  if (!realtime || !activeRole) return null;
  commandSequence += 1;
  const sent = realtime.send({
    ...payload,
    id: `${activeRole}-${Date.now()}-${commandSequence}`,
    role: activeRole,
    sequence: commandSequence,
  } as GameCommand);
  return sent ? commandSequence : null;
}

type OverlayAction = "ready" | "rematch" | "reload" | null;

let overlayAim: OverlayAction = null;
let divergence: string | null = null;

function playerName(role: PlayerRole): string {
  return role === "luca" ? "Luca" : "Senna";
}

/**
 * The one place that explains an interrupted match. Every state gets a Dutch
 * title, a reason, and at most one thing to do, so a child is never left with a
 * frozen arena and no idea why.
 */
function renderOverlay(snapshot: GameSnapshot): void {
  if (!activeRole) return;
  const { match } = snapshot.state;
  const own = match.players[activeRole];
  const peerRole = activeRole === "luca" ? "senna" : "luca";
  const peer = match.players[peerRole];

  if (divergence) {
    show("player");
    stageOverlay.hidden = false;
    overlayEyebrow.textContent = "Probleem";
    overlayTitle.textContent = "Het spel loopt niet gelijk";
    overlayMessage.textContent = divergence;
    overlayStatus.textContent = "";
    overlayAction.hidden = false;
    overlayAction.disabled = false;
    overlayAction.textContent = "Spel opnieuw laden";
    overlayAim = "reload";
    return;
  }

  if (match.phase === "finished") {
    stageOverlay.hidden = false;
    overlayEyebrow.textContent = "Afgelopen";
    overlayTitle.textContent =
      match.winner === null
        ? "Gelijkspel!"
        : `${playerName(match.winner)} heeft gewonnen!`;
    overlayMessage.textContent =
      match.winner === activeRole
        ? "Goed gedaan! Willen jullie nog een keer?"
        : match.winner === null
          ? "Jullie waren allebei op nul. Nog een keer?"
          : "Volgende keer win jij. Nog een keer?";
    overlayAction.hidden = false;
    overlayAction.textContent = own.ready ? "Klaar!" : "Nog een keer";
    overlayAction.disabled = own.ready;
    overlayStatus.textContent = own.ready
      ? `Wachten op ${playerName(peerRole)}...`
      : "";
    overlayAim = "rematch";
    return;
  }

  if (match.phase === "reconnecting") {
    stageOverlay.hidden = false;
    overlayEyebrow.textContent = "Verbinding";
    overlayTitle.textContent = "Verbinding herstellen";
    overlayMessage.textContent = peer.connected
      ? "Even wachten, het spel komt terug."
      : `${playerName(peerRole)} is even weg. Het spel staat stil.`;
    overlayAction.hidden = true;
    overlayStatus.textContent = "";
    overlayAim = null;
    return;
  }

  if (match.phase === "paused") {
    const connectionPause = match.pauseReason === "connection";
    stageOverlay.hidden = false;
    overlayEyebrow.textContent = connectionPause ? "Verbinding" : "Pauze";
    overlayTitle.textContent = connectionPause
      ? "De verbinding hapert"
      : match.pausedBy === activeRole
        ? "Jij hebt gepauzeerd"
        : `${playerName(match.pausedBy ?? peerRole)} heeft gepauzeerd`;
    overlayMessage.textContent = connectionPause
      ? "Het spel staat voor jullie beiden stil tot het weer goed gaat."
      : "Het spel gaat door als jullie allebei klaar zijn.";
    overlayAction.hidden = false;
    overlayAction.textContent = own.ready ? "Klaar!" : "Ik ben klaar";
    overlayAction.disabled = own.ready || !peer.connected;
    overlayStatus.textContent = !peer.connected
      ? `Wachten tot ${playerName(peerRole)} er weer is...`
      : own.ready
        ? `Wachten op ${playerName(peerRole)}...`
        : "";
    overlayAim = "ready";
    return;
  }

  stageOverlay.hidden = true;
  overlayAim = null;
}

overlayAction.addEventListener("click", () => {
  if (overlayAim === "reload") {
    location.reload();
    return;
  }
  if (overlayAim === "rematch") {
    overlayAction.disabled = true;
    overlayAction.textContent = "Even wachten...";
    sendCommand({ type: "rematch" });
    return;
  }
  if (overlayAim === "ready") {
    overlayAction.disabled = true;
    overlayAction.textContent = "Even wachten...";
    sendCommand({ type: "ready", ready: true });
  }
});

const MAXIMUM_HEALTH = 10;

/**
 * Hearts are drawn as icons plus an accessible text label, so the count never
 * depends on seeing colour or artwork.
 */
function renderHearts(target: HTMLElement, health: number): void {
  target.replaceChildren(
    ...Array.from({ length: MAXIMUM_HEALTH }, (_unused, index) => {
      if (index >= health) {
        const lost = document.createElement("span");
        lost.className = "heart";
        lost.dataset.lost = "true";
        return lost;
      }
      const heart = document.createElement("img");
      heart.src = "/art/icons/heart.png";
      heart.alt = "";
      heart.className = "heart";
      return heart;
    }),
  );
  target.ariaLabel = `${health} van de ${MAXIMUM_HEALTH} harten`;
}

const EFFECT_ICONS: Record<string, string> = {
  armor: "/art/icons/armor.png",
  camouflage: "/art/icons/camouflage.png",
  speed: "/art/icons/speed.png",
};

/**
 * Active powers are shown as an icon plus their remaining time or armor
 * capacity, and the same information is written into an accessible label.
 */
function renderEffects(player: PlayerState): void {
  if (player.effects.length === 0) {
    effectStatus.replaceChildren(document.createTextNode("Geen"));
    effectStatus.ariaLabel = "Geen krachten";
    return;
  }
  const parts: string[] = [];
  effectStatus.replaceChildren(
    ...player.effects.map((effect) => {
      const amount =
        effect.remainingTicks === null
          ? `${effect.capacity ?? 0}x`
          : `${Math.ceil(effect.remainingTicks / TICK_RATE)}s`;
      const label = CHEST_LABELS[effect.effectId];
      parts.push(`${label} ${amount}`);
      const chip = document.createElement("span");
      chip.className = "effect-chip";
      const icon = document.createElement("img");
      icon.src = EFFECT_ICONS[effect.effectId] ?? "";
      icon.alt = "";
      chip.append(icon, document.createTextNode(amount));
      return chip;
    }),
  );
  effectStatus.ariaLabel = parts.join(", ");
}

function weaponLabel(player: PlayerState): string {
  const weapon = selectedWeapon(player);
  const ammo = selectedItem(player)?.ammo;
  const label = WEAPON_LABELS[weapon] ?? "Vuisten";
  return ammo === null || ammo === undefined
    ? label
    : `${label} · ${ammo} pijltjes`;
}

/**
 * Shows at most one short instruction, and remembers what has been explained so
 * the second match is not full of tips. A lift or a chest in reach always wins,
 * because those are about what is in front of the child right now.
 */
function renderHint(snapshot: GameSnapshot): void {
  if (!activeRole) return;
  const { match } = snapshot.state;
  const own = match.players[activeRole];
  const peer = match.players[activeRole === "luca" ? "senna" : "luca"];
  const arena = arenaForWorld(match.arenaId);
  const nearby = teleportUnderPlayer(own, arena);
  const claimable = match.chests.some(
    (chest) =>
      snapshot.tick >= chest.landsAtTick &&
      Math.abs(chest.position.x - (own.position.x + own.size.width / 2)) <= 160,
  );
  const hint = chooseHint({
    phase: match.phase,
    used: usedControls,
    learned: learnedHints,
    opponentDistance: Math.abs(peer.position.x - own.position.x),
    chestWithinReach: claimable,
    teleportLabel: nearby ? nearby.label : null,
    holdsTwoWeapons: own.inventory.length > 1,
  });
  hintLine.hidden = hint === null;
  hintText.textContent = hint?.text ?? "";
}

/**
 * Records that this child has used a control. Doing a thing is what counts as
 * having learned it, so the hint for it never comes back, not even next week on
 * the same iPad.
 */
function markUsed(id: HintId): void {
  usedControls.add(id);
  if (learnedHints.has(id)) return;
  learnedHints = new Set([...learnedHints, id]);
  try {
    localStorage.setItem(HINT_STORAGE_KEY, writeLearned(learnedHints));
  } catch {
    // A locked-down browser store only costs the child a repeated tip.
  }
}

function renderLobby(snapshot: GameSnapshot): void {
  if (!activeRole) return;
  const { lobby, match } = snapshot.state;
  const own = match.players[activeRole];
  const peer = match.players[activeRole === "luca" ? "senna" : "luca"];
  // The arena stays on screen while the match is paused, recovering, or
  // finished, so the overlay explains what happened over the frozen picture.
  const inMatch = ["playing", "paused", "reconnecting", "finished"].includes(
    match.phase,
  );
  playerView.dataset.phase = match.phase;
  lobbyPanel.hidden = inMatch;
  gameStage.hidden = !inMatch;
  renderOverlay(snapshot);
  renderHearts(ownHearts, own.health);
  renderHearts(peerHearts, peer.health);
  weaponStatus.textContent = weaponLabel(own);
  renderEffects(own);
  const distance = Math.abs(peer.position.x - own.position.x);
  const direction = peer.position.x < own.position.x ? "links" : "rechts";
  opponentStatus.textContent = `${direction} · ${Math.round(distance / 10)} m`;
  opponentStatus.dataset.distance = String(Math.round(distance));
  // Both feet, so a journey can prove that a lift really moved somebody.
  opponentStatus.dataset.ownY = String(
    Math.round(own.position.y + own.size.height),
  );
  opponentStatus.dataset.peerY = String(
    Math.round(peer.position.y + peer.size.height),
  );
  const world = arenaForWorld(match.arenaId ?? lobby.selectedWorld);
  worldStatus.textContent = world.label;
  renderHint(snapshot);
  protectionStatus.hidden = own.invulnerableUntilTick <= snapshot.tick;
  if (match.phase !== "playing") pauseRequested = false;
  pauseButton.disabled = match.phase !== "playing" || pauseRequested;
  pauseButton.textContent = pauseRequested ? "Pauze aanvragen..." : "Pauze";
  const canChooseAppearance = ["world-selection", "ready"].includes(
    match.phase,
  );
  for (const button of cosmeticOptions.querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    button.ariaPressed = String(button.dataset.cosmetic === own.cosmetic);
    button.disabled = !canChooseAppearance;
  }

  const isChooser = lobby.chooser === activeRole;
  const chooserName = lobby.chooser === "luca" ? "Luca" : "Senna";
  chooserMessage.textContent = isChooser
    ? "Jij kiest deze ronde."
    : `${chooserName} kiest deze ronde.`;
  for (const button of worldOptions.querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    button.ariaPressed = String(button.dataset.world === lobby.selectedWorld);
    button.disabled = match.phase !== "world-selection" || !isChooser;
  }
  confirmWorld.hidden =
    match.phase !== "world-selection" ||
    isChooser ||
    lobby.selectedWorld === null;
  readyButton.hidden = !["ready", "paused", "countdown"].includes(match.phase);
  readyButton.disabled = match.phase === "countdown" || own.cosmetic === null;
  readyButton.textContent =
    match.phase === "countdown"
      ? "De strijd begint..."
      : own.ready
        ? "Klaar!"
        : "Ik ben klaar";
}

for (const cosmetic of COSMETICS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "option-button cosmetic-option";
  button.dataset.cosmetic = cosmetic.id;
  button.style.setProperty("--option-color", cosmetic.palette.primary);
  // The icon is decorative: the label carries the meaning on its own.
  const badge = document.createElement("span");
  badge.ariaHidden = "true";
  badge.textContent = cosmetic.icon;
  const picture = document.createElement("img");
  picture.src = `/art/icons/cosmetic-${cosmetic.id}.png`;
  picture.alt = "";
  picture.className = "cosmetic-image";
  picture.addEventListener("load", () => badge.replaceChildren(picture), {
    once: true,
  });
  const name = document.createElement("strong");
  name.textContent = cosmetic.label;
  button.replaceChildren(badge, name);
  button.addEventListener("click", () => {
    sendCommand({ type: "select-cosmetic", cosmetic: cosmetic.id });
  });
  cosmeticOptions.append(button);
}

for (const world of WORLDS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "option-button world-option";
  button.dataset.world = world.id;
  // The backdrop is decoration behind the label, which stays readable on its own.
  button.style.setProperty(
    "--world-image",
    `url("/art/worlds/${world.id}.png")`,
  );
  const worldName = document.createElement("span");
  worldName.className = "world-name";
  worldName.textContent = world.label;
  button.replaceChildren(worldName);
  button.addEventListener("click", () => {
    sendCommand({ type: "select-world", world: world.id });
  });
  worldOptions.append(button);
}

confirmWorld.addEventListener("click", () => {
  sendCommand({ type: "confirm-world" });
});

readyButton.addEventListener("click", () => {
  const ready = activeRole
    ? !(activeSnapshot?.state.match.players[activeRole].ready ?? false)
    : true;
  readyButton.disabled = true;
  readyButton.textContent = "Even wachten...";
  if (sendCommand({ type: "ready", ready }) === null && activeSnapshot) {
    renderLobby(activeSnapshot);
  }
});

pauseButton.addEventListener("click", () => {
  markUsed("pause");
  pauseRequested = true;
  pauseButton.disabled = true;
  pauseButton.textContent = "Pauze aanvragen...";
  if (sendCommand({ type: "pause" }) === null) {
    pauseRequested = false;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pauze";
  }
});

function renderSoundControls(): void {
  effectsToggle.textContent = audio.effectsMuted ? "Geluid uit" : "Geluid aan";
  effectsToggle.ariaPressed = String(!audio.effectsMuted);
  musicToggle.textContent = audio.musicMuted ? "Muziek uit" : "Muziek aan";
  musicToggle.ariaPressed = String(!audio.musicMuted);
}

// Audio may only start from a real gesture, so nothing is created before one.
function startAudio(): void {
  audio.unlock();
}
for (const eventName of ["pointerdown", "keydown"] as const) {
  window.addEventListener(eventName, startAudio, { once: true });
}
effectsToggle.addEventListener("click", () => {
  audio.unlock();
  audio.setEffectsMuted(!audio.effectsMuted);
  renderSoundControls();
  audio.play("pickup");
});
musicToggle.addEventListener("click", () => {
  audio.unlock();
  audio.setMusicMuted(!audio.musicMuted);
  renderSoundControls();
});
renderSoundControls();

function isPlaying(): boolean {
  return activeSnapshot?.state.match.phase === "playing";
}

/**
 * Proves to the room that this browser is still there. While a match runs that
 * is the held controls; while it is frozen a ping does the same job, because
 * controls are refused outside play and a refused command is not a heartbeat.
 */
function beat(): void {
  if (isPlaying()) {
    sendInput();
    return;
  }
  if (inMatch()) {
    lastInputSentAt = Date.now();
    realtime?.ping();
  }
}

/**
 * True while this browser still has to prove its connection. A pause does not
 * end that duty: the room only lets a frozen match continue once both sides are
 * heard from again, and a page that went quiet while paused would look like a
 * failing connection the moment play resumed.
 */
function inMatch(): boolean {
  const phase = activeSnapshot?.state.match.phase;
  return (
    phase === "playing" ||
    phase === "countdown" ||
    phase === "paused" ||
    phase === "reconnecting"
  );
}

let jumpWasHeld = false;
let lastInputSentAt = 0;
/** Controls this child has actually used, so a hint never nags about them. */
const usedControls = new Set<HintId>();
let learnedHints = readLearned(
  typeof localStorage === "undefined"
    ? null
    : localStorage.getItem(HINT_STORAGE_KEY),
);

function sendInput(): void {
  if (!isPlaying()) return;
  const intent = inputMapper.intent;
  // Jumping has no authoritative event of its own, so its sound is the local
  // feedback for pressing the control. Combat sounds wait for the server.
  if (intent.jump && !jumpWasHeld) audio.play("jump");
  jumpWasHeld = intent.jump;
  if (intent.horizontal !== 0) markUsed("move");
  if (intent.jump) markUsed("jump");
  if (intent.attack) markUsed("attack");
  if (intent.block) markUsed("block");
  if (intent.switchWeapon) markUsed("switch");
  lastInputSentAt = Date.now();
  const sequence = sendCommand({ type: "input", intent });
  if (sequence !== null) renderer?.setLocalIntent(sequence, intent);
  renderControlFeedback();
}

function renderControlFeedback(): void {
  const intent = inputMapper.intent;
  const active: Record<ControlAction, boolean> = {
    left: intent.horizontal < 0,
    right: intent.horizontal > 0,
    jump: intent.jump,
    attack: intent.attack,
    block: intent.block,
    action: intent.action,
    switchWeapon: intent.switchWeapon,
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-control]",
  )) {
    button.ariaPressed = String(
      active[button.dataset.control as ControlAction],
    );
  }
}

// The server treats silence as a failing connection, so the held controls are
// resent on a slow interval even when nothing changes. This is the heartbeat.
setInterval(beat, HEARTBEAT_INTERVAL_MS);

window.addEventListener("keydown", (event) => {
  if (!isPlaying() || event.repeat || !inputMapper.keyDown(event.code)) return;
  event.preventDefault();
  sendInput();
});
window.addEventListener("keyup", (event) => {
  if (!isPlaying() || !inputMapper.keyUp(event.code)) return;
  event.preventDefault();
  sendInput();
});
window.addEventListener("blur", () => {
  inputMapper.clear();
  sendInput();
});

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-control]",
)) {
  const action = button.dataset.control as ControlAction;
  button.addEventListener("pointerdown", (event) => {
    // A control is held down, often for seconds at a time. Left to itself an
    // iPad reads that as the start of a text selection or a callout menu, and
    // the child is suddenly fighting the browser instead of the other player.
    event.preventDefault();
    if (event.isPrimary) button.setPointerCapture(event.pointerId);
    inputMapper.press(`pointer:${event.pointerId}`, action);
    sendInput();
  });
}

// Disabling selection in CSS is not enough on iPadOS: a long press or a
// two-finger sweep still begins one. Outside a text field there is nothing here
// worth selecting, so the gesture is refused wherever it starts.
function refuseSelection(event: Event): void {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  )
    return;
  event.preventDefault();
}

for (const eventName of ["selectstart", "contextmenu", "dragstart"] as const) {
  document.addEventListener(eventName, refuseSelection);
}

// The release is heard on the window, not on the button. A finger that slides
// off a control, or a gesture the browser takes over, would otherwise never
// deliver the release, and the control would stay held down for the rest of the
// match: after that no new press can ever start an attack again.
function releasePointer(event: PointerEvent): void {
  if (!inputMapper.release(`pointer:${event.pointerId}`)) return;
  sendInput();
}

for (const eventName of [
  "pointerup",
  "pointercancel",
  "lostpointercapture",
] as const) {
  window.addEventListener(eventName, releasePointer);
}

async function loadSession(): Promise<void> {
  setConnection("loading", "Verbinding controleren...");
  try {
    const response = await fetch("/api/session", {
      credentials: "same-origin",
    });
    if (response.status === 401) {
      show("setup");
      setConnection("offline", "Nog niet gekoppeld");
      return;
    }
    if (!response.ok)
      throw new Error("De server is tijdelijk niet bereikbaar.");
    displaySession((await response.json()) as SessionResponse);
  } catch {
    show("setup");
    setConnection("offline", "Server niet bereikbaar");
    pairMessage.textContent =
      "De server is tijdelijk niet bereikbaar. Probeer het zo opnieuw.";
  }
}

async function pair(
  role: PlayerRole,
  pin: string,
  replace: boolean,
): Promise<void> {
  pairMessage.textContent = "Koppelen...";
  replacePanel.hidden = true;
  const response = await fetch("/api/pair", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, pin, replace }),
  });
  const result = (await response.json()) as { fout?: string; code?: string };
  if (response.status === 409 && result.code === "ROLE_OCCUPIED") {
    pendingReplacement = { role, pin };
    pairMessage.textContent = result.fout ?? "Deze speler is al gekoppeld.";
    replacePanel.hidden = false;
    return;
  }
  if (!response.ok) {
    pairMessage.textContent = result.fout ?? "Koppelen is niet gelukt.";
    return;
  }
  pendingReplacement = null;
  pairMessage.textContent = "Gekoppeld!";
  await loadSession();
}

pairForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(pairForm);
  const role = data.get("role");
  const pin = data.get("pin");
  if ((role === "luca" || role === "senna") && typeof pin === "string") {
    void pair(role, pin, false);
  }
});

replaceButton.addEventListener("click", () => {
  if (pendingReplacement) {
    void pair(pendingReplacement.role, pendingReplacement.pin, true);
  }
});

function startPractice(role: PlayerRole): void {
  practice = new PracticeSession(
    role,
    testBehaviourSelect.value as PracticeBehaviour,
  );
  attachSession(role, practice);
  practice.setWeapon(testWeaponSelect.value as ItemId | "unarmed");
}

function startTestMode(): void {
  testPanel.hidden = false;
  document.body.dataset.testMode = "aan";
  for (const behaviour of PRACTICE_BEHAVIOURS) {
    const option = document.createElement("option");
    option.value = behaviour;
    option.textContent = PRACTICE_BEHAVIOUR_LABELS[behaviour];
    testBehaviourSelect.append(option);
  }
  testBehaviourSelect.value = "follow";
  testRoleSelect.value = testModeRole === "senna" ? "senna" : "luca";
  testRoleSelect.addEventListener("change", () => {
    startPractice(testRoleSelect.value as PlayerRole);
  });
  testBehaviourSelect.addEventListener("change", () => {
    practice?.setBehaviour(testBehaviourSelect.value as PracticeBehaviour);
  });
  testWeaponSelect.addEventListener("change", () => {
    practice?.setWeapon(testWeaponSelect.value as ItemId | "unarmed");
  });
  testRestartButton.addEventListener("click", () => {
    practice?.restart();
  });
  startPractice(testRoleSelect.value as PlayerRole);
}

if (testMode) {
  startTestMode();
} else {
  void loadSession();
}

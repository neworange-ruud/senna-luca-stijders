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
import { CHEST_LABELS, COSMETICS, WORLDS } from "./game/content.js";
import { TICK_RATE } from "./game/config.js";
import { selectedItem, selectedWeapon } from "./game/items.js";
import type {
  GameCommand,
  GameSnapshot,
  ItemId,
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
const effectStatus = document.querySelector<HTMLElement>("#effect-status")!;
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

function phaseLabel(phase: GameSnapshot["state"]["match"]["phase"]): string {
  const labels = {
    waiting: "Wachten",
    "world-selection": "Wereld kiezen",
    ready: "Klaarmaken",
    countdown: "Aftellen",
    playing: "Spelen",
    paused: "Gepauzeerd",
    reconnecting: "Verbinding herstellen",
    finished: "Afgelopen",
  } as const;
  return labels[phase];
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
    renderLobby(snapshot);
    const update = renderer?.update(snapshot);
    qualityStatus.dataset.correction = `${Math.round(
      update?.correctionPixels ?? 0,
    )} px correctie`;
    if (update) audio.playEvents(update.events);
  });
  realtime.onError((error) => {
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

const WEAPON_LABELS: Record<string, string> = {
  unarmed: "Vuisten",
  sword: "Zwaard",
  "weak-sword": "Klein zwaard",
  nerf: "Blaster",
};

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

function renderLobby(snapshot: GameSnapshot): void {
  if (!activeRole) return;
  const { lobby, match } = snapshot.state;
  const own = match.players[activeRole];
  const peer = match.players[activeRole === "luca" ? "senna" : "luca"];
  const isPlaying = match.phase === "playing";
  playerView.dataset.phase = match.phase;
  lobbyPanel.hidden = isPlaying;
  gameStage.hidden = !isPlaying;
  renderHearts(ownHearts, own.health);
  renderHearts(peerHearts, peer.health);
  weaponStatus.textContent = weaponLabel(own);
  renderEffects(own);
  const distance = Math.abs(peer.position.x - own.position.x);
  const direction = peer.position.x < own.position.x ? "links" : "rechts";
  opponentStatus.textContent = `${direction} · ${Math.round(distance / 10)} m`;
  opponentStatus.dataset.distance = String(Math.round(distance));
  protectionStatus.hidden = own.invulnerableUntilTick <= snapshot.tick;
  pauseButton.disabled = match.phase !== "playing";
  pauseButton.textContent = "Pauze";
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
  pauseButton.disabled = true;
  pauseButton.textContent = "Pauze aanvragen...";
  if (sendCommand({ type: "pause" }) === null) {
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

let jumpWasHeld = false;

function sendInput(): void {
  if (!isPlaying()) return;
  const intent = inputMapper.intent;
  // Jumping has no authoritative event of its own, so its sound is the local
  // feedback for pressing the control. Combat sounds wait for the server.
  if (intent.jump && !jumpWasHeld) audio.play("jump");
  jumpWasHeld = intent.jump;
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
    if (event.isPrimary) button.setPointerCapture(event.pointerId);
    inputMapper.press(`pointer:${event.pointerId}`, action);
    sendInput();
  });
  const release = (event: PointerEvent) => {
    inputMapper.release(`pointer:${event.pointerId}`);
    sendInput();
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
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

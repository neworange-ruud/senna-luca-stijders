import "./style.css";
import type { JsonObject } from "./protocol";
import { StateClient } from "./state-client";

type PlayerId = "one" | "two";

type Player = {
  name: string;
  taps: number;
};

type GameState = {
  players: Partial<Record<PlayerId, Player>>;
  totalTaps: number;
  lastTap?: {
    player: PlayerId;
    at: number;
  };
};

const element = <T extends HTMLElement>(id: string): T => {
  const match = document.getElementById(id);
  if (!match) throw new Error(`Missing #${id}`);
  return match as T;
};

const client = new StateClient("/api/state", 500);
const lobby = element<HTMLElement>("lobby");
const game = element<HTMLElement>("game");
const joinForm = element<HTMLFormElement>("join-form");
const nameInput = element<HTMLInputElement>("name");
const connection = element<HTMLElement>("connection");
const errorMessage = element<HTMLElement>("error");
const tapButton = element<HTMLButtonElement>("tap-button");
let playerId: PlayerId | undefined;
let lastRenderedTap = 0;

nameInput.value = localStorage.getItem("tap-relay-name") ?? "";

function gameState(value: JsonObject | undefined): GameState | undefined {
  return value as unknown as GameState | undefined;
}

function playerLabel(id: PlayerId): string {
  return id === "one" ? "Player one" : "Player two";
}

function showError(error: unknown): void {
  errorMessage.textContent =
    error instanceof Error ? error.message : "Something went wrong.";
}

function render(value: JsonObject): void {
  const state = gameState(value)!;
  const one = state.players.one;
  const two = state.players.two;
  element("player-one-slot").textContent = one ? `Joined as ${one.name}` : "Open spot";
  element("player-two-slot").textContent = two ? `Joined as ${two.name}` : "Open spot";

  if (!playerId) return;

  const you = state.players[playerId];
  const peerId: PlayerId = playerId === "one" ? "two" : "one";
  const peer = state.players[peerId];
  element("your-name").textContent = you?.name ?? playerLabel(playerId);
  element("your-taps").textContent = String(you?.taps ?? 0);
  element("peer-name").textContent = peer?.name ?? `Waiting for ${playerLabel(peerId).toLowerCase()}`;
  element("peer-taps").textContent = String(peer?.taps ?? 0);
  element("total-taps").textContent = String(state.totalTaps ?? 0);

  if (state.lastTap) {
    const tapper = state.players[state.lastTap.player]?.name ?? playerLabel(state.lastTap.player);
    element("last-action").textContent = `${tapper} sent the latest pulse`;
    if (state.lastTap.at !== lastRenderedTap) {
      lastRenderedTap = state.lastTap.at;
      const pulse = element("pulse");
      pulse.classList.remove("is-moving");
      requestAnimationFrame(() => pulse.classList.add("is-moving"));
    }
  } else {
    element("last-action").textContent = "No taps yet";
  }
}

client.onState(render);
client.onStatus((status) => {
  connection.dataset.status = status;
  element("connection-label").textContent =
    status === "connected" ? "In sync" : status === "offline" ? "Offline" : "Syncing";
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(joinForm);
  const selectedPlayer = data.get("player");
  const name = nameInput.value.trim();
  if ((selectedPlayer !== "one" && selectedPlayer !== "two") || !name) return;

  playerId = selectedPlayer;
  localStorage.setItem("tap-relay-name", name);
  errorMessage.textContent = "";

  void client
    .update((draft) => {
      const state = gameState(draft)!;
      const current = state.players[playerId!];
      state.players[playerId!] = { name, taps: current?.taps ?? 0 };
    })
    .then(() => {
      lobby.hidden = true;
      game.hidden = false;
      render(client.current!);
    })
    .catch(showError);
});

tapButton.addEventListener("click", () => {
  if (!playerId) return;
  errorMessage.textContent = "";

  void client
    .update((draft) => {
      const state = gameState(draft)!;
      const current = state.players[playerId!];
      if (!current) return;
      current.taps += 1;
      state.totalTaps += 1;
      state.lastTap = { player: playerId!, at: Date.now() };
    })
    .catch(showError);
});

element("reset-game").addEventListener("click", () => {
  void client
    .update((draft) => {
      const state = gameState(draft)!;
      state.totalTaps = 0;
      delete state.lastTap;
      if (state.players.one) state.players.one.taps = 0;
      if (state.players.two) state.players.two.taps = 0;
    })
    .catch(showError);
});

element("switch-player").addEventListener("click", () => {
  playerId = undefined;
  game.hidden = true;
  lobby.hidden = false;
  if (client.current) render(client.current);
});

void client.start().catch(showError);

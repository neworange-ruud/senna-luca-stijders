# Browser Multiplayer Foundation

A minimal two-player browser game and generic shared-state API designed to deploy together as one Vercel project. The included **Tap Relay** game proves that both browsers can join, write state, resolve simultaneous changes, and observe each other's updates.

## How it works

- The static browser app polls `GET /api/state` every 500 ms while its tab is visible.
- Versioned requests return `204 No Content` with no JSON body when nothing changed.
- The browser writes an RFC 7396 JSON Merge Patch rather than the complete state. It uses `application/json` so Vercel parses the request body consistently.
- `X-State-Version` prevents one player from silently overwriting a concurrent move. The client receives the latest state and retries the move up to four times.
- The API keeps one JSON object on `globalThis` in the Vercel function process.
- There is deliberately no authentication, database, room system, or player ownership enforcement.

## Important limitation

This version uses function memory because that storage option was selected. Vercel does **not** guarantee that requests use the same function instance. State is lost on a cold start and can diverge if the two iPads reach different instances. The instance ID is part of `X-State-Version`, which lets a browser detect an instance change, but it cannot make two separate instances share memory.

This is suitable for experimentation, but it may occasionally fail even with honest players. The smallest reliable upgrade is a free Upstash Redis integration; the browser API can remain unchanged and only `server/state-store.ts` needs replacement.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

The Vercel CLI serves Vite and `/api/state` together. Open the printed local URL in two browser windows, select a different player in each, and tap.

Run all checks with:

```sh
npm run check
```

## Deploy to Vercel

1. Push this directory to a Git repository and import it at [vercel.com/new](https://vercel.com/new), or run `npx vercel` here.
2. Accept the detected settings. `vercel.json` builds the Vite app into `dist`, and Vercel deploys `api/state.ts` as a function.
3. Open the deployment URL on both iPads.

No environment variables or paid services are required.

## State API

The state handler is game-agnostic. Its entire state is one JSON object.

### Read

```http
GET /api/state
X-State-Version: "instance:revision"
```

Returns the complete state with `X-State-Version`, or `204` with no body when unchanged.

### Update

```http
PATCH /api/state
Content-Type: application/json
X-State-Version: "instance:revision"

{"players":{"one":{"taps":4}},"totalTaps":7}
```

Returns the updated state and a new `X-State-Version`. A stale version returns `412 Precondition Failed` plus the current state, allowing the browser to retry its change.

JSON Merge Patch uses `null` to remove an object property, so game state must not rely on object properties whose stored value is `null`. Null values inside arrays are unaffected.

To build another game, replace the initial object in `api/state.ts` and the game-specific UI/state mutations in `src/main.ts`. `src/state-client.ts` and the API protocol do not need to change.

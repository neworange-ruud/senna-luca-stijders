# Browser Multiplayer Foundation

A minimal two-player browser game and generic shared-state API designed to deploy together as one Vercel project. The included **Tap Relay** game proves that both browsers can join, write state, resolve simultaneous changes, and observe each other's updates.

## How it works

- The static browser app polls `GET /api/state` every 500 ms while its tab is visible.
- Versioned requests return `204 No Content` with no JSON body when nothing changed.
- The browser writes an RFC 7396 JSON Merge Patch rather than the complete state. It uses `application/json` so Vercel parses the request body consistently.
- `X-State-Version` prevents one player from silently overwriting a concurrent move. The client receives the latest state and retries the move up to four times.
- Upstash Redis holds one shared JSON object and revision for every Vercel function instance.
- A Redis Lua compare-and-set makes revision checking and state replacement atomic.
- There is deliberately no authentication, room system, or player ownership enforcement.

## Upstash Redis

The project requires an Upstash Redis resource connected through the Vercel Marketplace. It reads the credentials supplied by the integration:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

To provision the same free configuration from a linked project:

```sh
vercel integration add upstash/upstash-kv \
  --name browsergame-state \
  --plan free \
  --metadata primaryRegion=fra1 \
  --metadata eviction=true \
  --metadata autoUpgrade=false
```

Production, preview, and development use separate Redis keys so local testing cannot replace the production game state.
If a free-plan eviction ever removes the tiny state key, initialization uses a new high revision rather than reusing an old client version.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
vercel env pull .env.local
npm run dev
```

The Vercel CLI serves Vite and `/api/state` together. Open the printed local URL in two browser windows, select a different player in each, and tap.

Run all checks with:

```sh
npm run check
```

## Deploy to Vercel

1. Push this directory to a Git repository and import it at [vercel.com/new](https://vercel.com/new), or run `npx vercel` here.
2. Provision and connect Upstash Redis as described above.
3. Accept the detected settings. `vercel.json` builds the Vite app into `dist`, deploys `api/state.ts` in Frankfurt, and Vercel supplies the Redis credentials.
4. Open the deployment URL on both iPads.

The Upstash free plan is sufficient for light private use and automatic paid-plan upgrades can remain disabled.

## State API

The state handler is game-agnostic. Its entire state is one JSON object.

### Read

```http
GET /api/state
X-State-Version: "revision"
```

Returns the complete state with `X-State-Version`, or `204` with no body when unchanged.

### Update

```http
PATCH /api/state
Content-Type: application/json
X-State-Version: "revision"

{"players":{"one":{"taps":4}},"totalTaps":7}
```

Returns the updated state and a new `X-State-Version`. A stale version returns `412 Precondition Failed` plus the current state, allowing the browser to retry its change.

JSON Merge Patch uses `null` to remove an object property, so game state must not rely on object properties whose stored value is `null`. Null values inside arrays are unaffected.

To build another game, replace the initial object in `api/state.ts` and the game-specific UI/state mutations in `src/main.ts`. `src/state-client.ts` and the API protocol do not need to change.

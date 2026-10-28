# Streamer Alerts Bot

A Discord bot that watches streamers across five platforms and posts an alert
the moment one goes live. Built on Discord's **Components V2** display system,
with no API keys and no database to set up.

```
/streamer add      track a streamer and pick where alerts land
/streamer remove   stop tracking someone
/streamer list     see everyone tracked in this server
/help              commands and supported platforms
/ping              check the bot is responsive
```

## Why it looks different

Most alert bots post embeds. This one builds every surface from Components V2
containers, sections, media galleries and separators, so alerts carry the
platform's accent colour, the streamer's avatar as a section accessory, and the
stream preview inline — laid out deliberately rather than as an embed's fixed
shape.

`/streamer add` is a single modal built from `Label` components, collecting the
platform, handle, alert channel and optional mention role in one step.

## Requirements

- **Node.js 20.10** or newer
- **discord.js 14.27** or newer — earlier versions lack the `Label`,
  `RadioGroup` and `Checkbox` builders the modal flow depends on

## Setup

```sh
git clone <your-fork> && cd streamer-alerts-discord-bot
npm install
cp .env.example .env     # fill in DISCORD_TOKEN and CLIENT_ID
npm run dev              # or: npm run build && npm start
```

Slash commands register themselves on startup. The bot compares what Discord
has registered against what the code defines and writes only when they differ,
so a normal restart costs one read and nothing more — new commands appear,
removed ones disappear, and changed definitions update.

Set `GUILD_ID` in `.env` while developing so commands appear instantly. Leave
it empty to register globally, which takes up to an hour to propagate. Set
`SYNC_COMMANDS_ON_START=false` to manage commands from a separate process.

The bot needs only the **Guilds** intent — no privileged intents to enable. In
each alert channel it needs **View Channel** and **Send Messages**.

## Deploy anywhere

The bot is a single long-running Node process with no database to provision,
so it runs on anything that keeps Node 20.10+ online around the clock: a panel
host, a container platform, a VPS, or a spare machine at home.

[![Deploy on SparkedHost](https://img.shields.io/badge/Deploy%20on-SparkedHost-FF6A00?style=for-the-badge)](https://billing.sparkedhost.com/aff.php?aff=2551)
[![Deploy on Railway](https://img.shields.io/badge/Deploy%20on-Railway-7B2FBE?style=for-the-badge)](https://railway.com?referralCode=BankkRoll)

<sub>The two buttons above are referral links. Signing up through them
supports the project at no extra cost to you.</sub>

| Host | Type | Getting started |
| --- | --- | --- |
| [SparkedHost](https://billing.sparkedhost.com/aff.php?aff=2551) | Panel | [Steps below](#sparkedhost-and-other-panel-hosts) |
| [Railway](https://railway.com?referralCode=BankkRoll) | Container | [Steps below](#railway) |
| [PebbleHost](https://pebblehost.com) | Panel | Same steps as SparkedHost |
| [Bot-Hosting.net](https://bot-hosting.net) | Panel, free tier | Same steps as SparkedHost |
| [Cybrancee](https://cybrancee.com) | Panel | Same steps as SparkedHost |
| [Render](https://render.com) | Container | New **Background Worker** from this repo; add a disk at `/app/data` |
| [Koyeb](https://www.koyeb.com) | Container | New **Worker** service from this repo using the `Dockerfile` |
| [Fly.io](https://fly.io) | Container | `fly launch`, then a volume mounted at `/app/data` |
| [Hetzner](https://www.hetzner.com/cloud) | VPS | Install Docker, clone, `docker compose up -d` |
| [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) | VPS | Same steps as Hetzner |
| Your own machine | Any | Follow [Setup](#setup), or `docker compose up -d` |

Wherever it runs, set `DISCORD_TOKEN` and `CLIENT_ID`, and give `data/`
(`/app/data` in Docker) **persistent storage**. A host that wipes the
filesystem on redeploy loses every tracked streamer unless you switch to
`STORAGE_DRIVER=keyv` with a hosted database. Run exactly **one** instance;
two would post every alert twice.

### SparkedHost and other panel hosts

1. Order a **Discord Bot Hosting** plan from
   [SparkedHost](https://billing.sparkedhost.com/aff.php?aff=2551) and pick the
   **Node.js** server type, version 20 or newer. The smallest plan is enough.
2. In the panel, open **Startup** and set the Git repository to
   `https://github.com/BankkRoll/streamer-alerts-discord-bot` (or your fork),
   the branch to `main`, and the main file to `index.js`. If your panel has no
   Git option, upload the repository through **Files** instead.
3. In **Files**, create a `.env` file containing `DISCORD_TOKEN=` and
   `CLIENT_ID=` with your values. Copy any other settings you want from
   [.env.example](.env.example).
4. Press **Start**. The console shows the TypeScript build and then
   `Logged in as …` once the bot is online.

The root `index.js` is a small launcher for panel hosts. They run
`npm install` and then `node index.js` with no build step in between, so the
launcher compiles the source before starting the bot. Alerts are saved to
`data/` in the server's files, so they survive restarts and reinstalls.

**Running your own panel?** Import
[deploy/pterodactyl/egg-streamer-alerts-bot.json](deploy/pterodactyl/egg-streamer-alerts-bot.json)
under **Admin → Nests → Import Egg**. Servers created from that egg ask for the
token and application ID when they are created, clone and build the bot
automatically, and pull updates on every restart.

### Railway

1. [Sign up for Railway](https://railway.com?referralCode=BankkRoll), create a
   project, and choose **Deploy from GitHub repo** with this repository or your
   fork. [railway.json](railway.json) tells Railway to build the `Dockerfile`.
2. Under **Variables**, add `DISCORD_TOKEN`, `CLIENT_ID`, and
   `RAILWAY_RUN_UID=0`.
3. Right-click the service, choose **Attach Volume**, and mount it at
   `/app/data`.

`RAILWAY_RUN_UID=0` is needed because Railway mounts volumes as root, while the
image runs as the unprivileged `node` user and could not otherwise write there.

## Supported platforms

| Platform | Data source | Notes |
| --- | --- | --- |
| Twitch | public GraphQL | Full metadata |
| YouTube | watch page | Handles and channel IDs |
| Kick | public API | May be blocked from some hosts; see below |
| Rumble | channel page | Verifies it is a channel before parsing |
| TikTok | live page | Detects captcha walls |

No credentials are required for any of them. Each checker returns a descriptive
error when a page changes shape, rather than silently reporting "offline" — so
a broken scraper looks broken instead of looking quiet.

> **Kick and cloud hosts.** Kick blocks some datacentre IPs by TLS fingerprint.
> If Kick checks fail from your host, that is why; the bot reports it as an
> error rather than a false offline, and every other platform is unaffected.

## Configuration

Every setting is an environment variable with a working default. Only
`DISCORD_TOKEN` and `CLIENT_ID` are required. See [.env.example](.env.example)
for the annotated list.

The values worth knowing about:

| Variable | Default | Purpose |
| --- | --- | --- |
| `STORAGE_DRIVER` | `json` | `json`, `memory`, or `keyv` |
| `STORAGE_PATH` | `./data` | Where the JSON driver keeps its files |
| `POLL_INTERVAL_MS` | `60000` | Gap between poll cycles |
| `POLL_CONCURRENCY` | `5` | Simultaneous checks per cycle |
| `ALERT_COOLDOWN_MS` | `1800000` | Suppress repeat alerts within this window |
| `MAX_STREAMERS_PER_GUILD` | `100` | Per-guild cap |
| `ITEMS_PER_PAGE` | `5` | Rows per `/streamer list` page |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `LOG_JSON` | `false` | JSON lines for log aggregators |

Configuration is validated once at startup. A bad value stops the process with
a message naming every problem at once, rather than one per restart.

## Storage

Storage is a small driver interface, and the default needs no installation.

**`json`** (default) writes a single file under `STORAGE_PATH`. It is not a
naive `writeFileSync`:

- writes are debounced, so one poll cycle costs one disk write
- each write goes to a temp file and is `rename`d into place, which is atomic
- the previous good file is kept as `.bak`
- on startup a corrupt file falls back to the backup, and if neither parses the
  bot **refuses to start** rather than beginning with an empty dataset — an
  empty start would let the next write destroy recoverable data

**`memory`** persists nothing. Useful for tests and ephemeral deployments.

**`keyv`** delegates to any [Keyv](https://keyv.org) backend — SQLite,
Postgres, Redis, MySQL, Mongo. It is imported lazily, so the package is only
needed if you select it:

```sh
npm install keyv @keyv/sqlite
```

```ini
STORAGE_DRIVER=keyv
STORAGE_CONNECTION_STRING=sqlite://data/bot.sqlite
```

Adding a backend means implementing five methods in `src/storage/types.ts`; the
shared contract test suite then covers it automatically.

## Development

```sh
npm run dev          # watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # eslint, type-aware
npm test             # vitest
npm run check        # all three, as CI runs them
```

The test suite covers the storage drivers hard, including crash recovery,
corruption handling, and a regression test for the concurrent-write bug that
the repository's per-guild locking exists to prevent.

## Architecture

```
src/
  config/      validated, env-overridable settings
  storage/     driver interface, json/memory/keyv drivers, guild repository
  platforms/   per-platform checkers over a shared retrying fetch
  ui/          Components V2 builders, theme, and the component-budget guard
  commands/    slash commands
  handlers/    button, select, and modal routing
  services/    alert delivery, polling, runtime context
  lib/         custom-id codec, cooldowns
  events/      gateway wiring
```

Two details that carry most of the reliability:

**Per-guild write locks.** A poll cycle spends seconds awaiting HTTP between
reading a guild's streamers and writing results back. Mutations are serialised
per guild and re-read inside the lock, so a `/streamer add` landing mid-cycle
is never overwritten.

**A component budget guard.** Discord rejects messages over 40 components with
an opaque 400. `src/ui/budget.ts` audits every payload before it is sent, and
the list's page size is *derived* from the budget rather than hardcoded, so a
row gaining a component cannot silently break pagination.

## Notes on Components V2

Worth knowing before changing the UI code:

- `MessageFlags.IsComponentsV2` must be re-sent on **every** edit, not just the
  first send. Omitting it on an edit is a 400.
- The flag is **irreversible per message**. Once an alert is sent with it, that
  message can never be edited back into an embed.
- `content` and `embeds` stop working entirely under the flag.
- A Section holds 1–3 Text Displays and exactly one accessory, which may be a
  Button or a Thumbnail — never a select menu.
- discord.js does **not** enforce the 5-component modal cap; a sixth builds
  cleanly and is rejected by the API.

Fuller notes, verified against the shipped builder typings, live in
[.docs/](.docs/).

## License

MIT — see [LICENSE](LICENSE).

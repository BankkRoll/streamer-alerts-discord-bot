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
npm run deploy           # register slash commands
npm run dev              # or: npm run build && npm start
```

Set `GUILD_ID` in `.env` while developing so commands appear instantly.
Leave it empty to deploy globally, which takes up to an hour to propagate.

The bot needs only the **Guilds** intent — no privileged intents to enable. In
each alert channel it needs **View Channel** and **Send Messages**.

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

# Contributing

Thanks for taking an interest. This document covers what you need to know
before changing the code.

## Getting set up

```sh
pnpm install
cp .env.example .env    # DISCORD_TOKEN and CLIENT_ID are the only required values
pnpm run dev
```

Set `GUILD_ID` while developing so `pnpm run deploy` registers commands
instantly instead of waiting on global propagation.

## Before opening a pull request

```sh
pnpm run check    # typecheck + lint + test, the same gates CI runs
```

All three must pass. CI runs them on Node 20.10 and 22.

## Things that will trip you up

**Components V2 is not embeds.** Every user-facing surface is a container
tree. The rules that cause real failures:

- Re-send `MessageFlags.IsComponentsV2` on **every** edit. Omitting it on an
  edit is a 400, not a silent downgrade.
- The flag cannot be removed from a message once sent.
- A Section takes 1–3 Text Displays and exactly one accessory, which must be a
  Button or a Thumbnail. `setButtonAccessory()` accepts a select menu without
  complaint and then fails at send time.
- discord.js does not enforce the 5-component modal cap. Ours does, in
  `src/ui/modals.ts`.

Run any new surface through `assertWithinBudget()` — it catches limit
violations with a stack trace instead of an opaque HTTP error.

**Storage is concurrent.** The poller and user commands write to the same
guild records. Go through `GuildRepository`; it serialises mutations per guild
and re-reads inside the lock. Writing to a driver directly reintroduces the
lost-update bug that `tests/storage/repository.test.ts` exists to catch.

**Platform checkers must never throw.** Return a `LiveStatus` with `error` set
instead. A checker that throws takes down that cycle for every other streamer
in the guild.

Just as important: an undetermined check is **not** an offline check. If a page
changes shape, set `error` — do not return a bare `isLive: false`. Reporting
offline on a parse failure means the bot looks healthy while alerting nobody.

**Comments explain why, not what.** If the code already says what it does, no
comment. Comment the non-obvious: a platform quirk, why a retry rule exists,
why a check the compiler thinks is redundant is load-bearing.

## Adding a platform

1. Add the id to `PLATFORM_IDS` in `src/types/streamer.ts`.
2. Add presentation metadata to `PLATFORMS` in `src/ui/theme.ts`.
3. Write the checker in `src/platforms/`, using the shared `http.ts` helper.
4. Register it in `src/platforms/index.ts`.
5. Add username rules to `src/platforms/validation.ts`.

The registry uses `satisfies Record<Platform, PlatformChecker>`, so step 1
fails the build until step 4 lands. That is deliberate.

## Adding a storage backend

Implement the five methods in `src/storage/types.ts` and add the case to
`createDriver()`. Point the shared contract suite in
`tests/helpers/driver-contract.ts` at it and the standard behaviours are
covered for free — write additional tests only for behaviour unique to your
backend.

Keep new backends optional: import them lazily, as `src/storage/keyv.ts` does,
so the default install stays dependency-free.

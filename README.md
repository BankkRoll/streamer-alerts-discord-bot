# Streamer Alerts Bot

A modern, type-safe Discord bot that monitors streaming platforms and sends beautiful notifications when your favorite streamers go live. Built with TypeScript, discord.js v14, and modern Discord components.

**No API keys required** - Uses public endpoints and HTML parsing to fetch live status.

**Simple setup** - Just add your bot token and run. Uses Enmap for zero-config persistent storage.

<img width="452" height="507" alt="image" src="https://github.com/user-attachments/assets/2e6d46d8-d03d-4795-a1ee-2c88baac673c" />

<img width="470" height="518" alt="image" src="https://github.com/user-attachments/assets/a44962f7-4d90-4447-9eb3-33af8e04f538" />

<img width="455" height="438" alt="image" src="https://github.com/user-attachments/assets/86c33a33-c776-48d0-a51e-e8befef3ace1" />

<img width="447" height="271" alt="image" src="https://github.com/user-attachments/assets/eb9978ae-49f1-428d-b53d-7e12b79049bd" />

<img width="380" height="542" alt="image" src="https://github.com/user-attachments/assets/3a164b4b-afff-4422-83b3-e7ab77d6eb87" />

---

## Features

- **Multi-Platform Support**: Kick, Twitch, YouTube, Rumble, TikTok
- **Real-Time Alerts**: 60-second polling with smart duplicate detection
- **Modern Discord UI**: Buttons, select menus, modals, rich embeds
- **Type-Safe**: Full TypeScript with strict typing
- **Zero API Keys**: Works without platform API credentials
- **Zero Config Database**: Enmap handles persistence automatically
- **Per-Server Config**: Each Discord server manages its own streamer list

---

## Commands

| Command            | Description                | Permissions     |
| ------------------ | -------------------------- | --------------- |
| `/streamer add`    | Add a streamer to track    | Manage Channels |
| `/streamer remove` | Remove a streamer          | Manage Channels |
| `/streamer list`   | List all tracked streamers | None            |
| `/help`            | Interactive help menu      | None            |
| `/ping`            | Check bot latency          | None            |

### /streamer add \<platform\> \<username\>

**Options:**

- `platform` - Choose: Kick, Twitch, YouTube, Rumble, TikTok
- `username` - Streamer's username/handle

**Flow:**

1. Bot shows embed with channel select menu
2. Pick notification channel
3. Streamer added → Success embed

### /streamer remove

**Flow:**

1. Bot shows embed with streamer select menu (your tracked streamers)
2. Pick streamer to remove
3. Confirm with Yes/Cancel buttons
4. Streamer removed → Success embed

### /streamer list

**Shows:**

- All tracked streamers with platform emoji
- Notification channel for each
- Live status indicator (🔴 LIVE)
- Pagination buttons if > 10 streamers

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env

# 3. Add your Discord bot token to .env
DISCORD_TOKEN=your_token_here

# 4. Deploy slash commands
npm run deploy

# 5. Start the bot
npm start
```

### Development

```bash
npm run dev       # Run with hot reload
npm run build     # Compile TypeScript
npm run typecheck # Check types
npm run lint      # Lint code
```

---

## Tech Stack

| Technology         | Purpose                   |
| ------------------ | ------------------------- |
| **TypeScript**     | Type-safe development     |
| **discord.js v14** | Discord API               |
| **Enmap**          | Simple persistent storage |
| **node-fetch**     | HTTP requests             |
| **kick.com-api**   | Kick public API wrapper   |

---

## Platform Colors & Emojis

| Platform | Color     | Emoji |
| -------- | --------- | ----- |
| Kick     | `#53FC18` | 🟢    |
| Twitch   | `#9146FF` | 🟣    |
| YouTube  | `#FF0000` | 🔴    |
| Rumble   | `#85C742` | 🟢    |
| TikTok   | `#010101` | ⚫    |

---

## How It Works

### Polling Loop

```
Every 60 seconds:
├── For each guild
│   ├── Get tracked streamers from Enmap
│   ├── For each streamer
│   │   ├── Call platform checker
│   │   ├── Compare title with cache
│   │   ├── If live + new title → Send alert
│   │   └── Update streamer data
│   └── Save to Enmap
```

### Alert Embed

```
┌─────────────────────────────────────────┐
│ 🟣 StreamerName is LIVE on Twitch       │
├─────────────────────────────────────────┤
│ Playing Minecraft - Building a Castle   │
│                                         │
│ 👀 Viewers    │ 👥 Followers │ ⏰ Started│
│ 1,234         │ 50.2K        │ 2h ago   │
│                                         │
│ [Stream Preview Thumbnail]              │
│                                         │
│ [🟣 Watch on Twitch]                    │
└─────────────────────────────────────────┘
```

---

## Bot Permissions

### Required Intents

- `Guilds`
- `GuildMessages`

### Required Permissions

- Send Messages
- Embed Links
- Use External Emojis

---

## License

> [!IMPORTANT]
> **Disclaimer:**
> Please note that the APIs used in this bot are not owned or maintained by us. The usage of these APIs is at your own risk, and we make no guarantees regarding the availability, accuracy, or functionality of these services. If you are the endpoint owner and would like to remove them please open a issue and ill handle it accordingly.

This project is licensed under the MIT License. For more details, see the [LICENSE](./LICENSE) file in the repository.

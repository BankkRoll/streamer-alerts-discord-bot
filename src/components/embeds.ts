import { EmbedBuilder } from "discord.js";
import type { LiveStatus, Streamer, Platform } from "../types/index.js";
import {
  PLATFORMS,
  Colors,
  FOOTER,
  ITEMS_PER_PAGE,
} from "../utils/constants.js";
import {
  formatNumber,
  discordTimestamp,
  truncate,
} from "../utils/formatters.js";

/**
 * Create a live alert embed
 */
export function createLiveEmbed(status: LiveStatus): EmbedBuilder {
  const platform = PLATFORMS[status.platform];

  const embed = new EmbedBuilder()
    .setColor(platform.color)
    .setURL(status.url)
    .setTimestamp();

  // Author section - streamer info with profile pic
  const verifiedBadge = status.verified ? " ✓" : "";
  embed.setAuthor({
    name: `${status.username}${verifiedBadge} is LIVE`,
    iconURL: status.profileImage,
    url: status.url,
  });

  // Title - stream title
  if (status.title) {
    embed.setTitle(truncate(status.title, 256));
  }

  // Build description with key info
  const descParts: string[] = [];

  if (status.category) {
    descParts.push(`**Playing:** ${status.category}`);
  }

  if (status.viewers !== undefined) {
    descParts.push(`**Viewers:** ${formatNumber(status.viewers)}`);
  }

  if (status.followers !== undefined) {
    const label = status.platform === "youtube" ? "Subscribers" : "Followers";
    descParts.push(`**${label}:** ${formatNumber(status.followers)}`);
  }

  if (descParts.length > 0) {
    embed.setDescription(descParts.join(" • "));
  }

  // Fields for additional data
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  // Row 1: Started, Language, Mature
  if (status.startedAt) {
    fields.push({
      name: "Started",
      value: discordTimestamp(status.startedAt, "R"),
      inline: true,
    });
  }

  if (status.language) {
    fields.push({
      name: "Language",
      value: status.language.toUpperCase(),
      inline: true,
    });
  }

  if (status.isMature) {
    fields.push({
      name: "Mature",
      value: "18+",
      inline: true,
    });
  }

  // Tags row
  if (status.tags && status.tags.length > 0) {
    const displayTags = status.tags
      .slice(0, 6)
      .map((t) => `\`${t}\``)
      .join(" ");
    fields.push({
      name: "Tags",
      value: displayTags,
      inline: false,
    });
  }

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  // Stream preview as main image
  if (status.thumbnail) {
    embed.setImage(status.thumbnail);
  }

  // Category icon as thumbnail (small, on the right)
  if (status.categoryIcon) {
    embed.setThumbnail(status.categoryIcon);
  } else if (status.profileImage && !status.thumbnail) {
    embed.setThumbnail(status.profileImage);
  }

  // Footer with platform name
  embed.setFooter({
    text: platform.name,
    iconURL: FOOTER.iconURL,
  });

  return embed;
}

/**
 * Create a streamer list embed
 */
export function createListEmbed(
  streamers: Streamer[],
  page: number = 1,
): EmbedBuilder {
  const totalPages = Math.ceil(streamers.length / ITEMS_PER_PAGE) || 1;
  const startIndex = (page - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, streamers.length);
  const pageStreamers = streamers.slice(startIndex, endIndex);

  const embed = new EmbedBuilder()
    .setColor(Colors.INFO)
    .setTitle(
      `📋 Tracked Streamers (${startIndex + 1}-${endIndex} of ${streamers.length})`,
    )
    .setTimestamp();

  if (streamers.length === 0) {
    embed.setDescription(
      "No streamers are being tracked.\n\nUse `/streamer add` to add a streamer.",
    );
    return embed;
  }

  const description = pageStreamers
    .map((s) => {
      const platform = PLATFORMS[s.platform];
      const liveIndicator = s.isLive ? " • 🔴 LIVE" : "";
      return `${platform.emoji} **${s.username}** • ${platform.name}${liveIndicator}\n   └ Alerts → <#${s.channelId}>`;
    })
    .join("\n\n");

  embed.setDescription(description);
  embed.setFooter({ text: `Page ${page}/${totalPages}` });

  return embed;
}

/**
 * Create the add streamer prompt embed
 */
export function createAddPromptEmbed(
  platform: Platform,
  username: string,
): EmbedBuilder {
  const platformConfig = PLATFORMS[platform];

  return new EmbedBuilder()
    .setColor(platformConfig.color)
    .setTitle(`${platformConfig.emoji} Add ${platformConfig.name} Streamer`)
    .setDescription(
      `Adding: **${username}** on ${platformConfig.name}\n\n` +
        `Select the channel for notifications:`,
    );
}

/**
 * Create a success embed
 */
export function createSuccessEmbed(
  title: string,
  description?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.SUCCESS)
    .setTitle(`✅ ${title}`);

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

/**
 * Create an error embed
 */
export function createErrorEmbed(
  title: string,
  description?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.ERROR)
    .setTitle(`❌ ${title}`);

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

/**
 * Create a warning/confirm embed
 */
export function createWarningEmbed(
  title: string,
  description?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.WARNING)
    .setTitle(`⚠️ ${title}`);

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

/**
 * Create the remove confirmation embed
 */
export function createRemoveConfirmEmbed(streamer: Streamer): EmbedBuilder {
  const platform = PLATFORMS[streamer.platform];

  return new EmbedBuilder()
    .setColor(Colors.WARNING)
    .setTitle("⚠️ Confirm Removal")
    .setDescription(`Remove **${streamer.username}** (${platform.name})?`);
}

/**
 * Create the remove selection embed
 */
export function createRemoveSelectEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.INFO)
    .setTitle("🗑️ Remove Streamer")
    .setDescription("Select a streamer to remove:");
}

/**
 * Create the help embed
 */
export function createHelpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.INFO)
    .setTitle("📚 Streamer Alerts Bot - Help")
    .setDescription(
      "Track your favorite streamers and get notified when they go live!",
    )
    .addFields(
      {
        name: "📡 Streamer Commands",
        value: [
          "`/streamer add <platform> <username>` - Add a streamer to track",
          "`/streamer remove` - Remove a tracked streamer",
          "`/streamer list` - List all tracked streamers",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🛠️ Utility Commands",
        value: [
          "`/help` - Show this help message",
          "`/ping` - Check bot latency",
        ].join("\n"),
        inline: false,
      },
      {
        name: "📺 Supported Platforms",
        value: Object.values(PLATFORMS)
          .map((p) => `${p.emoji} ${p.name}`)
          .join(" • "),
        inline: false,
      },
    )
    .setTimestamp();
}

/**
 * Create a ping embed
 */
export function createPingEmbed(
  latency: number,
  apiLatency: number,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.INFO)
    .setTitle("🏓 Pong!")
    .addFields(
      { name: "Latency", value: `${latency}ms`, inline: true },
      { name: "API Latency", value: `${apiLatency}ms`, inline: true },
    );
}

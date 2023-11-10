// src/utils/streamAlerts.js
const { guildSettings } = require("../../db");
const { createEmbed } = require("./embed");
const { MessageActionRow, MessageButton } = require('discord.js');
const { checkTwitchLive } = require("./twitch");
const { checkYouTubeLive } = require("./youtube");
const { checkRumbleLive } = require("./rumble");
const { checkKickLive } = require("./kick");
// const { checkTikTokLive } = require("./tiktok");

const lastLiveData = new Map();

module.exports = {
  init: (client) => {
    setInterval(() => checkStreamers(client), 60 * 1000);
  },
};

async function checkStreamers(client) {
  if (client.guilds.cache.size === 0) return;

  for (const [guildId, guild] of client.guilds.cache) {
    let streamers = guildSettings.get(guildId, "streamers") || [];

    for (let i = 0; i < streamers.length; i++) {
      try {
        const liveInfo = await checkIfLive(streamers[i]);
        const liveStreamKey = `${guildId}-${streamers[i].id}`;
        const lastLive = lastLiveData.get(liveStreamKey);

        const shouldSendEmbed =
          liveInfo.isLive &&
          (!lastLive || lastLive.title !== liveInfo.streamer.title);

          if (shouldSendEmbed) {
            const channel = client.channels.cache.get(streamers[i].channelID);
            if (channel) {
              const { embed, components } = createStreamerEmbed(liveInfo.streamer);
              await channel.send({ embeds: [embed], components });
            }

          lastLiveData.set(liveStreamKey, {
            title: liveInfo.streamer.title,
            imageUrl: liveInfo.streamer.imageUrl,
            isLive: liveInfo.isLive,
          });
        }

        if (!liveInfo.isLive && lastLiveData.has(liveStreamKey)) {
          lastLiveData.delete(liveStreamKey);
        }

        streamers[i] = {
          ...streamers[i],
          ...liveInfo.streamer,
          lastLiveAt: liveInfo.isLive ? new Date() : streamers[i].lastLiveAt,
        };
        await guildSettings.set(guildId, "streamers", streamers);
      } catch (error) {
        console.error(
          `Error during live check for ${streamers[i].name}:`,
          error
        );
      }
    }
  }
}

async function checkIfLive(streamer) {
  const platformCheckers = {
    twitch: checkTwitchLive,
    youtube: checkYouTubeLive,
    rumble: checkRumbleLive,
    kick: checkKickLive,
    // tiktok: checkTikTokLive,
  };

  const checker = platformCheckers[streamer.platform.toLowerCase()];
  if (checker) {
    return checker(streamer);
  }
  return { isLive: false, streamer };
}

function createStreamerEmbed(streamer) {
  const platformDetails = {
    twitch: { color: '#9146FF', emoji: '🟪' },
    youtube: { color: '#FF0000', emoji: '🟥' },
    rumble: { color: '#90EE90', emoji: '🟩' },
    kick: { color: '#00FF00', emoji: '🟩' },
    tiktok: { color: '#000000', emoji: '🔳' },
  };

  const currentPlatform = platformDetails[streamer.platform.toLowerCase()] || { color: 'DEFAULT', emoji: '🔴' };

  let description = `${streamer.username || streamer.name} is live now on [${
    streamer.platform
  }](${streamer.url}).`;
  if (streamer.bio) {
    description += "\n\n" + streamer.bio;
  }

  const fields = [];
  if (streamer.viewers) {
    fields.push({
      name: "👀 Viewers",
      value: streamer.viewers.toString(),
      inline: true,
    });
  }
  if (streamer.startedAt) {
    let startedAtDate = new Date(streamer.startedAt);
    if (!startedAtDate.getTime()) {
      startedAtDate = new Date(streamer.startedAt + 'Z');
    }
    
    if (!isNaN(startedAtDate.getTime())) {
      const discordTimestamp = Math.floor(startedAtDate.getTime() / 1000);
      fields.push({
        name: "⏰ Started At",
        value: `<t:${discordTimestamp}:R>`,
        inline: true,
      });
    }
  }
  const followerLabel =
    streamer.platform.toLowerCase() === "youtube"
      ? "👥 Subscribers"
      : "👥 Followers";
  if (streamer.followersCount) {
    fields.push({
      name: followerLabel,
      value: streamer.followersCount.toString(),
      inline: true,
    });
  }
  if (streamer.verified) {
    fields.push({ name: "✅ Verified", value: "Yes", inline: true });
  }

  const button = new MessageButton()
    .setLabel(`${streamer.name} live now on ${streamer.platform}!`)
    .setStyle('LINK')
    .setURL(streamer.url)
    .setEmoji(currentPlatform.emoji);

  const row = new MessageActionRow().addComponents(button);

  return {
    embed: createEmbed({
      title: streamer.title || "Live Stream",
      url: streamer.url,
      description: description,
      color: currentPlatform.color,
      image: streamer.imageUrl || undefined,
      fields: fields,
    }),
    components: [row]
  };
}

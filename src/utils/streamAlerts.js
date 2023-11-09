// src/utils/streamAlerts.js
const { guildSettings } = require("../../db");
const { createEmbed } = require("./embed");
const { checkTwitchLive } = require("./twitch");
const { checkYouTubeLive } = require("./youtube");
const { checkRumbleLive } = require("./rumble");
const { checkKickLive } = require("./kick");
// const { checkTikTokLive } = require("./tiktok");
const config = require("../../config.json");

const liveStreamers = new Set();
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

        const shouldSendEmbed =
          liveInfo.isLive && !lastLiveData.has(liveStreamKey);

        if (shouldSendEmbed) {
          const channel = client.channels.cache.get(streamers[i].channelID);
          if (channel) {
            const embed = createStreamerEmbed(liveInfo.streamer);
            await channel.send({ embeds: [embed] });
          }

          lastLiveData.set(liveStreamKey, {
            title: liveInfo.streamer.title,
            imageUrl: liveInfo.streamer.imageUrl,
            isLive: liveInfo.isLive,
            embedSent: true,
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
  let description = `Check out the live stream on [${streamer.platform}](${streamer.url}).`;
  if (streamer.bio) {
    description += "\n\n" + streamer.bio;
  }

  const fields = [];
  if (streamer.viewerCount || streamer.viewers) {
    fields.push({
      name: "👀 Viewers",
      value: streamer.viewerCount?.toString() || streamer.viewers.toString(),
      inline: true,
    });
  }
  if (streamer.startedAt) {
    const discordTimestamp = Math.floor(
      new Date(streamer.startedAt).getTime() / 1000
    );
    fields.push({
      name: "⏰ Started At",
      value: `<t:${discordTimestamp}:R>`,
      inline: true,
    });
  }
  if (streamer.followersCount) {
    fields.push({
      name: "👥 Followers",
      value: streamer.followersCount.toString(),
      inline: true,
    });
  }
  if (streamer.verified === true) {
    fields.push({ name: "✅ Verified", value: "Yes", inline: true });
  }

  return createEmbed({
    title: `${streamer.title || "Live Stream"}`,
    url: streamer.url,
    description: description,
    color: config.color,
    image: streamer.imageUrl || undefined,
    fields: fields,
  });
}

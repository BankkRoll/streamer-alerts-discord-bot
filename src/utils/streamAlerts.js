// src/utils/streamAlerts.js
const { guildSettings } = require("../../db");
const { createEmbed } = require("./embed");
const { checkTwitchLive } = require("./twitch");
const { checkYouTubeLive } = require("./youtube");
const { checkRumbleLive } = require("./rumble");
const config = require("../../config.json");

const liveStreamers = new Set();

module.exports = {
  init: (client) => {
    setInterval(() => checkStreamers(client), 60 * 1000);
  },
};

async function checkStreamers(client) {
  if (client.guilds.cache.size === 0) return;

  for (const [guildId, guild] of client.guilds.cache) {
    let streamers = guildSettings.get(guildId, "streamers") || [];
    console.log(`Guild ID: ${guildId}, Streamers:`, streamers);

    for (let i = 0; i < streamers.length; i++) {
      try {
        const liveInfo = await checkIfLive(streamers[i]);
        console.log(liveInfo);

        const liveStreamKey = `${guildId}-${streamers[i].id}`;

        if (liveInfo.isLive && !liveStreamers.has(liveStreamKey)) {
          liveStreamers.add(liveStreamKey);
          streamers[i] = { ...streamers[i], ...liveInfo.streamer };
          await guildSettings.set(guildId, "streamers", streamers);

          streamers[i].title = liveInfo.streamer.title;
          streamers[i].description = liveInfo.streamer.description;
          streamers[i].imageUrl = liveInfo.streamer.imageUrl;
          streamers[i].url = liveInfo.streamer.url;

          await guildSettings.set(guildId, "streamers", streamers);

          const channel = client.channels.cache.get(streamers[i].channelID);
          if (!channel) continue;

          const embed = createEmbed({
            title: streamers[i].title || "Live Stream",
            description: `Check out the live stream on [${
              streamers[i].platform
            }](${streamers[i].url || " "}).`,
            color: config.color,
            image: streamers[i].imageUrl || " ",
          });

          await channel.send({ embeds: [embed] });
        } else if (!liveInfo.isLive && liveStreamers.has(liveStreamKey)) {
          liveStreamers.delete(liveStreamKey);
          streamers[i].isLive = false;
          await guildSettings.set(guildId, "streamers", streamers);
        }
      } catch (error) {
        console.error("Error during live check:", error);
      }
    }
  }
}

async function checkIfLive(streamer) {
  const platformCheckers = {
    twitch: checkTwitchLive,
    youtube: checkYouTubeLive,
    rumble: checkRumbleLive,
    // kick: checkKickLive,
    // tiktok: checkTikTokLive,
  };

  const checker = platformCheckers[streamer.platform.toLowerCase()];
  if (checker) {
    return checker(streamer);
  }
  return { isLive: false, streamer };
}

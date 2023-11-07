const { guildSettings } = require("../../db");
const { createEmbed } = require("./embed");
const { checkTwitchLive } = require("./twitch");
const { checkYouTubeLive } = require("./youtube");
const { checkRumbleLive } = require("./rumble");
// const { checkKickLive } = require("./kick");
// const { checkTikTokLive } = require("./tiktok");
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
    let streamers = guildSettings.get(guildId, "streamers");
    if (!streamers) {
      streamers = [];
    }

    for (const streamer of streamers) {
      const liveInfo = await checkIfLive(streamer);
      const liveStreamKey = `${guildId}-${streamer.id}`;

      if (liveInfo.isLive && !liveStreamers.has(liveStreamKey)) {
        liveStreamers.add(liveStreamKey);
        const channel = client.channels.cache.get(streamer.channelID);
        if (!channel) continue;

        const embed = createEmbed({
          title: liveInfo.title,
          description: `${liveInfo.description}\nCheck out the live stream on [${streamer.platform}](${liveInfo.url}).`,
          color: config.color,
          image: liveInfo.imageUrl,
        });

        await channel.send({ embeds: [embed] });
      } else if (!liveInfo.isLive) {
        liveStreamers.delete(liveStreamKey);
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

// src/utils/kick.js
const { KickApiWrapper } = require("kick.com-api");

async function checkKickLive(streamer) {
  const kickApi = new KickApiWrapper();

  try {
    const data = await kickApi.fetchChannelData(streamer.name);

    if (data && data.livestream && data.livestream.is_live) {
      const cleanedBio = data.user.bio.replace(/\[7TV:[^\]]+\]/g, "").trim();

      const result = {
        isLive: true,
        streamer: {
          platform: "kick",
          username: data.user.username,
          bio: cleanedBio,
          followersCount: data.followers_count,
          profileImageUrl: data.user.profile_pic,
          verified: data.verified,
          name: streamer.name,
          title: data.livestream.session_title,
          viewers: data.livestream.viewer_count,
          imageUrl: data.user.profile_pic,
          startedAt: data.livestream.start_time,
          url: `https://kick.com/${streamer.name}`,
        },
      };

      return result;
    }

    return { isLive: false };
  } catch (error) {
    console.error(
      `Error checking Kick live status for ${streamer.name}:`,
      error
    );
    return { isLive: false, error: error.message };
  }
}

module.exports = {
  checkKickLive,
};

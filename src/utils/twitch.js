// src/utils/twitch.js
(async () => {
  fetch = (await import("node-fetch")).default;
})();

async function checkTwitchLive(streamer) {
  try {
    const response = await fetch(`https://twitch.tv/${streamer.name}`);
    const sourceCode = await response.text();
    const isLive = sourceCode.includes('"isLiveBroadcast":true');

    streamer.url = `https://twitch.tv/${streamer.name}`;

    if (isLive) {
      const jsonLdMatch = sourceCode.match(
        /<script type="application\/ld\+json">(\[.*?\])<\/script>/s
      );
      if (jsonLdMatch && jsonLdMatch[1]) {
        const jsonLd = JSON.parse(jsonLdMatch[1]);
        const liveData = jsonLd.find((data) => data["@type"] === "VideoObject");

        if (liveData) {
          streamer.title = liveData.name;
          streamer.description = liveData.description;
          streamer.imageUrl = liveData.thumbnailUrl[2];
          streamer.startedAt = liveData.publication.startDate;
        }
      }
    }
    return { isLive, streamer };
  } catch (error) {
    console.error(
      `Error checking Twitch live status for ${streamer.name}:`,
      error
    );
    return { isLive: false, streamer };
  }
}

module.exports = {
  checkTwitchLive,
};

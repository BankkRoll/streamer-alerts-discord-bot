// src/utils/youtube.js
let fetch;

(async () => {
  fetch = (await import("node-fetch")).default;
})();

async function checkYouTubeLive(streamer) {
  try {
    const response = await fetch(`https://www.youtube.com/@${streamer.name}`);
    const sourceCode = await response.text();

    const isLive = sourceCode.includes('"text":"LIVE"');
    if (isLive) {
      const titleMatch = sourceCode.match(/"label":"([^"]+) by/);
      streamer.title = titleMatch ? titleMatch[1] : "Live Stream";

      const imageUrlRegex =
        /"url":"(https:\/\/i\.ytimg\.com\/[^"]+)",(?:[^}]*"width":336)/;
      const imageUrlMatch = sourceCode.match(imageUrlRegex);
      streamer.imageUrl = imageUrlMatch ? imageUrlMatch[1] : null;

      streamer.url = `https://www.youtube.com/@${streamer.name}`;
      const viewCountMatch = sourceCode.match(
        /"viewCountText":\{"runs":\[\{"text":"(\d+)"\},\{"text":" watching"\}\]\}/
      );
      streamer.viewers = viewCountMatch ? parseInt(viewCountMatch[1]) : null;

      return { isLive: true, streamer };
    }

    return { isLive: false };
  } catch (error) {
    console.error(
      `Error checking YouTube live status for @${streamer.name}:`,
      error
    );
    return { isLive: false };
  }
}

module.exports = {
  checkYouTubeLive,
};

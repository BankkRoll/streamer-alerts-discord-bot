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
      const imageUrlRegex =
        /"url":"(https:\/\/i\.ytimg\.com\/[^"]+)",(?:[^}]*"width":336)/;
      const imageUrlMatch = sourceCode.match(imageUrlRegex);
      const viewCountMatch = sourceCode.match(
        /"viewCountText":\{"runs":\[\{"text":"([\d,]+)"\},\{"text":" watching"\}\]\}/
      );
      const descriptionMatch = sourceCode.match(
        /"descriptionSnippet":\s*\{"runs":\s*\[\{"text":"([^"]+)"\}\]\}/
      );
      const subscribersMatch = sourceCode.match(
        /"subscriberCountText":\s*\{"simpleText":"([\d\.KM]+) subscribers"\}/
      );

      const result = {
        isLive: true,
        streamer: {
          platform: "youtube",
          username: streamer.name,
          bio: descriptionMatch
            ? descriptionMatch[1].replace(/\\n/g, "\n")
            : null,
          followersCount: subscribersMatch
            ? parseSubscribersCount(subscribersMatch[1])
            : null,
          profileImageUrl: null,
          verified: null,
          name: streamer.name,
          title: titleMatch ? titleMatch[1] : "Live Stream",
          viewers: viewCountMatch
            ? parseInt(viewCountMatch[1].replace(/,/g, ""))
            : null,
          imageUrl: imageUrlMatch ? imageUrlMatch[1] : null,
          startedAt: null,
          url: `https://www.youtube.com/@${streamer.name}`,
        },
      };

      return result;
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

function parseSubscribersCount(subscriberText) {
  const multiplier = subscriberText.endsWith("K")
    ? 1000
    : subscriberText.endsWith("M")
    ? 1000000
    : 1;
  return parseInt(subscriberText.replace(/[KM]/, "")) * multiplier;
}

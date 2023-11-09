// src/utils/rumble.js
(async () => {
  fetch = (await import("node-fetch")).default;
})();

async function checkRumbleLive(streamer) {
  try {
    const response = await fetch(`https://rumble.com/user/${streamer.name}`);
    const sourceCode = await response.text();

    const isLive = sourceCode.includes('data-value="LIVE"');
    streamer.url = `https://rumble.com/c/${streamer.name}`;

    if (isLive) {
      const titleMatch = sourceCode.match(
        /<h3 class=["']?video-item--title["']?>(.*?)<\/h3>/i
      );
      const imageUrlMatch = sourceCode.match(
        /<img class=["']?video-item--img["']?[^>]*src=["']?([^"'\s>]+)["']?[^>]*>/i
      );
      const viewerCountMatch = sourceCode.match(
        /<span class=["']?video-item--watching["']?>([\d,]+) watching<\/span>/i
      );
      const followersCountMatch = sourceCode.match(
        /<span class=["']listing-header--followers["']?>([\d,]+) Followers<\/span>/i
      );
      const profileImageUrlMatch = sourceCode.match(
        /<img class=["']?listing-header--thumb["']?[^>]*src=["']?([^"'\s>]+)["']?[^>]*>/i
      );
      const startedAtMatch = sourceCode.match(
        /<time class=["']?video-item--meta video-item--time["']? datetime=([^"'\s>]+)[^>]*>/i
      );

      streamer.title = titleMatch ? titleMatch[1].trim() : "Live Stream";
      streamer.imageUrl = imageUrlMatch ? imageUrlMatch[1] : null;
      streamer.viewerCount = viewerCountMatch
        ? parseInt(viewerCountMatch[1].replace(/,/g, ""), 10)
        : 0;
      streamer.followersCount = followersCountMatch
        ? parseInt(followersCountMatch[1].replace(/,/g, ""), 10)
        : 0;
      streamer.verified = null;
      streamer.bio = null;
      streamer.profileImageUrl = profileImageUrlMatch
        ? profileImageUrlMatch[1]
        : null;
      streamer.startedAt = startedAtMatch
        ? new Date(startedAtMatch[1]).toISOString()
        : null;
    }

    return { isLive, streamer };
  } catch (error) {
    console.error(
      `Error checking Rumble live status for ${streamer.name}:`,
      error
    );
    return { isLive: false, streamer };
  }
}

module.exports = {
  checkRumbleLive,
};

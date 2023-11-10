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
      const titleMatch = sourceCode.match(/<h3 class=["']video-item--title["']?>(.*?)<\/h3>/i);
      const imageUrlMatch = sourceCode.match(/<img class=["']video-item--img["']?[^>]*src=["']?([^"'\s>]+)["']?[^>]*>/i);
      const viewerCountMatch = sourceCode.match(/<span class=["']video-item--watching["']?>([\d.]+[KMB]? watching)<\/span>/i);
      const profileImageUrlMatch = sourceCode.match(/<img class=["']listing-header--thumb["']?[^>]*src=["']?([^"'\s>]+)["']?[^>]*>/i);
      const followersCountMatch = sourceCode.match(
        /<span class=["']channel-header--followers["']?>([\d.,]+[KMB]?) Followers<\/span>/i
      );

      const followersCountExtracted = followersCountMatch ? convertToNumber(followersCountMatch[1]) : 0;

      const startedAtMatch = sourceCode.match(/<time class=["']video-item--meta video-item--time["']? datetime=["']?([^"'\s>]+)["']?/i);
      if (startedAtMatch && startedAtMatch[1]) {
        const startedAtDate = new Date(startedAtMatch[1]);
        streamer.startedAt = startedAtDate.toISOString();
      } else {
        console.log('No valid started at time found.');
        streamer.startedAt = null;
      }

      const viewerCountExtracted = viewerCountMatch ? viewerCountMatch[1].replace(' watching', '').replace('K', '000').replace('M', '000000').replace('B', '000000000').replace('.', '') : '0';

      function convertToNumber(followersString) {
        let numberMultiplier = 1;

        if (followersString.includes('K')) {
          numberMultiplier = 1e3;
        } else if (followersString.includes('M')) {
          numberMultiplier = 1e6;
        } else if (followersString.includes('B')) {
          numberMultiplier = 1e9;
        }

        return parseFloat(followersString.replace(/[KMB,]/g, '')) * numberMultiplier;
      }
      streamer.title = titleMatch ? titleMatch[1].trim() : "Live Stream";
      streamer.imageUrl = imageUrlMatch ? imageUrlMatch[1] : null;
      streamer.viewerCount = parseInt(viewerCountExtracted, 10);
      streamer.followersCount = followersCountExtracted;
      streamer.verified = sourceCode.includes('channel-header--verified verification-badge-icon');
      streamer.bio = null;
      streamer.profileImageUrl = profileImageUrlMatch ? profileImageUrlMatch[1] : null;
      streamer.startedAt = startedAtMatch ? new Date(startedAtMatch[1]).toISOString() : null;
    }

    return { isLive, streamer };
  } catch (error) {
    console.error(`Error checking Rumble live status for ${streamer.name}:`, error);
    return { isLive: false, streamer };
  }
}

module.exports = {
  checkRumbleLive,
};
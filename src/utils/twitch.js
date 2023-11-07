// src/utils/twitch.js
let fetch;

(async () => {
  fetch = (await import('node-fetch')).default;
})();

async function checkTwitchLive(streamer) {
    try {
        const response = await fetch(`https://twitch.tv/${streamer.name}`);
        const sourceCode = await response.text();
        const isLive = sourceCode.includes('"isLiveBroadcast":true');

        if (isLive) {
            streamer.title = sourceCode.match(/<meta property="og:title" content="([^"]+)"\/>/)[1];
            streamer.description = sourceCode.match(/<meta property="og:description" content="([^"]+)"\/>/)[1];
            streamer.url = `https://twitch.tv/${streamer.name}`;
            const imageUrlRegex = /"thumbnailUrl":\["[^"]+","([^"]+320x180\.jpg)"/;
            const imageUrlMatch = sourceCode.match(imageUrlRegex);
            streamer.imageUrl = imageUrlMatch ? imageUrlMatch[1] : "";
            return { isLive: true, streamer };
        }

        return { isLive: false };
    } catch (error) {
        console.error(`Error checking Twitch live status for ${streamer.name}:`, error);
        return { isLive: false };
    }
}

module.exports = {
    checkTwitchLive
};

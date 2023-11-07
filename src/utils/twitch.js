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
        let titleMatch, descriptionMatch, imageUrlMatch;

        if (isLive) {
            titleMatch = sourceCode.match(/<meta property="og:title" content="([^"]+)"\/>/);
            descriptionMatch = sourceCode.match(/<meta property="og:description" content="([^"]+)"\/>/);
            imageUrlMatch = sourceCode.match(/"thumbnailUrl":\["[^"]+","([^"]+320x180\.jpg)"/);

            streamer.title = titleMatch ? titleMatch[1] : "";
            streamer.description = descriptionMatch ? descriptionMatch[1] : "";
            streamer.url = `https://twitch.tv/${streamer.name}`;
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

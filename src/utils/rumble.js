// src/utils/rumble.js
let fetch;

(async () => {
  fetch = (await import('node-fetch')).default;
})();

async function checkRumbleLive(streamer) {
    try {
        const response = await fetch(`https://rumble.com/c/${streamer.name}`);
        const sourceCode = await response.text();

        const isLive = sourceCode.includes('<span class="video-item--live" data-value="LIVE"></span>');
        if (isLive) {
            const titleMatch = sourceCode.match(/<h3 class="video-item--title">(.*?)<\/h3>/);
            streamer.title = titleMatch ? titleMatch[1] : 'Live Stream';

            const imageUrlMatch = sourceCode.match(/<img class="video-item--img" src="(https:\/\/[^ ]+\.jpg)"/);
            streamer.imageUrl = imageUrlMatch ? imageUrlMatch[1] : null;

            streamer.url = `https://rumble.com/c/${streamer.name}`;

            const viewerCountMatch = sourceCode.match(/<span class="video-item--watching">(\d+) watching<\/span>/);
            streamer.viewerCount = viewerCountMatch ? parseInt(viewerCountMatch[1], 10) : 0;

            return { isLive: true, streamer };
        }

        return { isLive: false };
    } catch (error) {
        console.error(`Error checking Rumble live status for ${streamer.name}:`, error);
        return { isLive: false };
    }
}

module.exports = {
    checkRumbleLive
};

// src/utils/rumble.js
let fetch;

(async () => {
    fetch = (await import('node-fetch')).default;
})();

async function checkRumbleLive(streamer) {
    try {
        const response = await fetch(`https://rumble.com/user/${streamer.name}`);
        const sourceCode = await response.text();

        const isLive = sourceCode.includes('data-value="LIVE"');

        if (isLive) {
            const titleRegex = /<h3 class=["']?video-item--title["']?>(.*?)<\/h3>/i;
            const titleMatch = sourceCode.match(titleRegex);
            streamer.title = titleMatch ? titleMatch[1].trim() : 'Live Stream';

            const imageRegex = /<img class=["']?video-item--img["']?[^>]*src=["']?([^"'\s>]+)["']?[^>]*>/i;
            const imageUrlMatch = sourceCode.match(imageRegex);
            streamer.imageUrl = imageUrlMatch ? imageUrlMatch[1] : null;


            streamer.url = `https://rumble.com/c/${streamer.name}`;

            const viewerCountRegex = /<span class=["']?video-item--watching["']?>([\d,]+) watching<\/span>/i;
            const viewerCountMatch = sourceCode.match(viewerCountRegex);
            streamer.viewerCount = viewerCountMatch ? parseInt(viewerCountMatch[1].replace(/,/g, ''), 10) : 0;

            return { isLive: true, streamer };
        }

        return { isLive: false, streamer };
    } catch (error) {
        console.error(`Error checking Rumble live status for ${streamer.name}:`, error);
        return { isLive: false, streamer };
    }
}

module.exports = {
    checkRumbleLive
};
// src/utils/kick.js
const puppeteer = require("puppeteer");

async function checkKickLive(streamer) {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
    );

    await page.goto(`https://kick.com/api/v2/channels/${streamer.name}`, {
      waitUntil: "networkidle0",
    });

    const data = await page.evaluate(() =>
      JSON.parse(document.body.textContent)
    );

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
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  checkKickLive,
};

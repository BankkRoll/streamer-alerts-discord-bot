import type { LiveStatus } from "./types.js";
import { parseFormattedNumber } from "../utils/formatters.js";
import { logger } from "../utils/logger.js";

/**
 * Check if a Rumble streamer is live via HTML scraping
 */
export async function checkRumbleLive(username: string): Promise<LiveStatus> {
  const channelUrl = `https://rumble.com/c/${username}`;

  const baseResult: LiveStatus = {
    isLive: false,
    platform: "rumble",
    username,
    url: channelUrl,
  };

  try {
    const response = await fetch(channelUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return baseResult;
    }

    const html = await response.text();

    // Extract channel header data
    const profileMatch = html.match(
      /class=["']channel-header--img["'][^>]*src=["']([^"']+)["']/,
    );
    const profileImage = profileMatch?.[1];

    const nameMatch = html.match(/<h1>([^<]+)<\/h1>/);
    const channelName = nameMatch?.[1]?.trim();

    const verified = html.includes("channel-header--verified");

    const followersMatch = html.match(/([\d,]+)\s*Followers/);
    const followers = followersMatch?.[1]
      ? parseFormattedNumber(followersMatch[1].replace(/,/g, ""))
      : undefined;

    // Check if there's a live stream
    const isLive =
      html.includes("videostream__status--live") ||
      html.includes("thumbnail__thumb--live");

    if (!isLive) {
      return {
        ...baseResult,
        username: channelName ?? username,
        followers,
        profileImage,
        verified,
      };
    }

    // Extract live stream data
    const titleMatch = html.match(
      /class=["']thumbnail__title[^"']*["'][^>]*>([^<]+)/,
    );
    const title = titleMatch?.[1]?.trim();

    // Live viewer count (in the videostream__views-ppv badge)
    const viewersMatch = html.match(
      /videostream__views-ppv["'][^>]*>[\s\S]*?<span class=["']videostream__number["']>\s*(\d+)/,
    );
    const viewers = viewersMatch?.[1]
      ? parseInt(viewersMatch[1], 10)
      : undefined;

    // Thumbnail
    const thumbMatch = html.match(
      /class=["']thumbnail__image[^"']*["'][^>]*src=["']([^"']+)["']/,
    );
    const thumbnail = thumbMatch?.[1];

    // Stream URL
    const urlMatch = html.match(
      /class=["']videostream__link[^"']*["'][^>]*href=["']([^"']+)["']/,
    );
    const streamUrl = urlMatch?.[1]
      ? `https://rumble.com${urlMatch[1].split("?")[0]}`
      : channelUrl;

    return {
      isLive: true,
      platform: "rumble",
      username: channelName ?? username,
      title,
      viewers,
      followers,
      thumbnail,
      profileImage,
      url: streamUrl,
      verified,
    };
  } catch (error) {
    logger.error(`Error checking Rumble live status for ${username}:`, error);
    return { ...baseResult, error: String(error) };
  }
}

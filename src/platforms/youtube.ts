import type { LiveStatus } from "./types.js";
import { parseFormattedNumber } from "../utils/formatters.js";
import { logger } from "../utils/logger.js";

/**
 * YouTube ytInitialData types (partial)
 */
interface YouTubeInitialData {
  contents?: {
    twoColumnWatchNextResults?: {
      results?: {
        results?: {
          contents?: Array<{
            videoPrimaryInfoRenderer?: {
              title?: { runs?: Array<{ text: string }> };
              viewCount?: {
                videoViewCountRenderer?: {
                  isLive?: boolean;
                  originalViewCount?: string;
                  viewCount?: { runs?: Array<{ text: string }> };
                };
              };
            };
            videoSecondaryInfoRenderer?: {
              owner?: {
                videoOwnerRenderer?: {
                  title?: { runs?: Array<{ text: string }> };
                  subscriberCountText?: { simpleText?: string };
                  thumbnail?: { thumbnails?: Array<{ url: string }> };
                };
              };
            };
          }>;
        };
      };
    };
  };
}

/**
 * Check if a YouTube channel is live by fetching /live page
 */
export async function checkYouTubeLive(username: string): Promise<LiveStatus> {
  const channelUrl = `https://www.youtube.com/@${username}`;
  const liveUrl = `https://www.youtube.com/@${username}/live`;
  const baseResult: LiveStatus = {
    isLive: false,
    platform: "youtube",
    username,
    url: channelUrl,
  };

  try {
    // Fetch the /live page - redirects to active stream if live
    const response = await fetch(liveUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return baseResult;
    }

    const html = await response.text();

    // Extract ytInitialData JSON
    const dataMatch = html.match(/var ytInitialData = ({.*?});/s);
    if (!dataMatch) {
      // Fallback: check for simple live indicator
      if (html.includes('"isLive":true')) {
        return { ...baseResult, isLive: true };
      }
      return baseResult;
    }

    const data: YouTubeInitialData = JSON.parse(dataMatch[1]);

    // Navigate to video info
    const contents =
      data.contents?.twoColumnWatchNextResults?.results?.results?.contents;
    if (!contents) {
      return baseResult;
    }

    // Find primary and secondary info renderers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let primaryInfo: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let secondaryInfo: any;

    for (const item of contents) {
      if (item.videoPrimaryInfoRenderer) {
        primaryInfo = item.videoPrimaryInfoRenderer;
      }
      if (item.videoSecondaryInfoRenderer) {
        secondaryInfo = item.videoSecondaryInfoRenderer;
      }
    }

    // Check if actually live
    const viewCountRenderer = primaryInfo?.viewCount?.videoViewCountRenderer;
    const isLive = viewCountRenderer?.isLive === true;

    if (!isLive) {
      // Extract profile data even if not live
      const owner = secondaryInfo?.owner?.videoOwnerRenderer;
      const subsText = owner?.subscriberCountText?.simpleText ?? "";
      const subsMatch = subsText.match(/([\d.]+[KMB]?)/i);
      const thumbnails = owner?.thumbnail?.thumbnails;

      return {
        ...baseResult,
        followers: subsMatch ? parseFormattedNumber(subsMatch[1]) : undefined,
        profileImage: thumbnails?.[thumbnails.length - 1]?.url,
      };
    }

    // Extract live stream data
    const title = primaryInfo?.title?.runs?.[0]?.text;
    const viewers = viewCountRenderer?.originalViewCount
      ? parseInt(viewCountRenderer.originalViewCount, 10)
      : undefined;

    const owner = secondaryInfo?.owner?.videoOwnerRenderer;
    const channelName = owner?.title?.runs?.[0]?.text;
    const subsText = owner?.subscriberCountText?.simpleText ?? "";
    const subsMatch = subsText.match(/([\d.]+[KMB]?)/i);
    const followers = subsMatch
      ? parseFormattedNumber(subsMatch[1])
      : undefined;
    const thumbnails = owner?.thumbnail?.thumbnails;
    const profileImage = thumbnails?.[thumbnails.length - 1]?.url;

    // Extract video ID for thumbnail
    const videoIdMatch = html.match(/"videoId":"([^"]+)"/);
    const videoId = videoIdMatch?.[1];
    const thumbnail = videoId
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : undefined;

    // Get the actual stream URL
    const streamUrl = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : channelUrl;

    return {
      isLive: true,
      platform: "youtube",
      username: channelName ?? username,
      title,
      viewers,
      followers,
      thumbnail,
      profileImage,
      url: streamUrl,
    };
  } catch (error) {
    logger.error(`Error checking YouTube live status for ${username}:`, error);
    return { ...baseResult, error: String(error) };
  }
}

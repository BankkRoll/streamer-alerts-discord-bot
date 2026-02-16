import type { LiveStatus } from "./types.js";
import { logger } from "../utils/logger.js";

/**
 * Twitch's public Client-ID for unauthenticated requests
 */
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

/**
 * Twitch GraphQL API response types
 */
interface TwitchGraphQLResponse {
  data?: {
    user?: {
      id: string;
      login: string;
      displayName: string;
      description: string;
      createdAt: string;
      profileImageURL: string;
      bannerImageURL?: string;
      followers?: {
        totalCount: number;
      };
      roles?: {
        isPartner: boolean;
        isAffiliate: boolean;
      };
      stream?: {
        id: string;
        title: string;
        type: string;
        viewersCount: number;
        createdAt: string;
        language: string;
        game?: {
          id: string;
          name: string;
          displayName: string;
          boxArtURL?: string;
        };
        previewImageURL?: string;
        tags?: Array<{ localizedName: string }>;
        isMature?: boolean;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * GraphQL query for user and stream data
 */
const USER_STREAM_QUERY = `
  query GetUserStream($login: String!) {
    user(login: $login) {
      id
      login
      displayName
      description
      createdAt
      profileImageURL(width: 300)
      bannerImageURL
      followers {
        totalCount
      }
      roles {
        isPartner
        isAffiliate
      }
      stream {
        id
        title
        type
        viewersCount
        createdAt
        language
        previewImageURL(width: 640, height: 360)
        game {
          id
          name
          displayName
          boxArtURL(width: 144, height: 192)
        }
        tags {
          localizedName
        }
      }
    }
  }
`;

/**
 * Check if a Twitch streamer is live via GraphQL API
 */
export async function checkTwitchLive(username: string): Promise<LiveStatus> {
  const url = `https://twitch.tv/${username}`;
  const baseResult: LiveStatus = {
    isLive: false,
    platform: "twitch",
    username,
    url,
  };

  try {
    const response = await fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: {
        "Client-ID": TWITCH_CLIENT_ID,
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({
        query: USER_STREAM_QUERY,
        variables: { login: username.toLowerCase() },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as TwitchGraphQLResponse;

    if (data.errors?.length) {
      throw new Error(data.errors[0].message);
    }

    const user = data.data?.user;

    if (!user) {
      return baseResult;
    }

    // User exists but not streaming
    if (!user.stream || user.stream.type !== "live") {
      return {
        ...baseResult,
        followers: user.followers?.totalCount,
        profileImage: user.profileImageURL,
        bio: user.description,
        verified: user.roles?.isPartner ?? false,
      };
    }

    // User is live
    const stream = user.stream;
    const tags = stream.tags?.map((t) => t.localizedName) ?? [];

    return {
      isLive: true,
      platform: "twitch",
      username: user.login,
      title: stream.title,
      viewers: stream.viewersCount,
      followers: user.followers?.totalCount,
      thumbnail: stream.previewImageURL,
      profileImage: user.profileImageURL,
      startedAt: stream.createdAt,
      url,
      verified: user.roles?.isPartner ?? false,
      bio: user.description,
      category: stream.game?.displayName ?? stream.game?.name,
      categoryIcon: stream.game?.boxArtURL,
      tags,
      language: stream.language,
    };
  } catch (error) {
    logger.error(`Error checking Twitch live status for ${username}:`, error);
    return { ...baseResult, error: String(error) };
  }
}

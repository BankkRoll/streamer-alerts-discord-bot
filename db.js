// db.js
const Enmap = require("enmap");

/**
 * Streamer data structure:
 * {
 *   id: String, // A unique identifier for the streamer
 *   name: String, // The streamer's name
 *   platform: String, // The platform the streamer is on (e.g., Twitch, YouTube)
 *   channelID: String, // The Discord channel ID where alerts should be sent
 *   platformUserID: String, // The streamer's user ID on the platform (if applicable)
 *   liveStatus: [
 *     {
 *       isLive: Boolean, // Whether the streamer is currently live
 *       timestamp: Date, // The timestamp of this status
 *       viewers: Number, // Current number of viewers, if known
 *     }
 *   ],
 *   lastLiveAt: Date, // The last time the streamer was detected as live
 *   error: String, // Error message if the last status check failed
 * }
 */

/**
 * @type {import("enmap").Enmap}
 * Custom settings for each guild.
 */
const guildSettings = new Enmap({
  name: "guildSettings",
  autoEnsure: {
    streamers: [],
  },
  ensureProps: true,
});

module.exports = {
  guildSettings,
};

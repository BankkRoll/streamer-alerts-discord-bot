// src/commands/social/liststreamers.js
const { Command } = require("@sapphire/framework");
const { guildSettings } = require("../../../db");
const { createEmbed } = require("../../utils/embed");

module.exports = class ListStreamersCommand extends Command {
  constructor(context, options) {
    super(context, {
      ...options,
      name: "liststreamers",
      description: "List all tracked streamers.",
    });
  }

  async registerApplicationCommands(registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description)
    );
  }

  async chatInputRun(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const streamers = guildSettings.get(guildId, "streamers", []);

    if (streamers.length === 0) {
      const embed = createEmbed({
        description: "No streamers are being tracked currently.",
      });
      return interaction.followUp({ embeds: [embed] });
    }

    const streamersListString = streamers
      .map((streamer, index) => {
        // Use startedAt property to maintain consistency with streamAlerts.js
        const lastLiveTimestamp = streamer.startedAt
          ? Math.floor(new Date(streamer.startedAt).getTime() / 1000)
          : null;
        // Create a Discord timestamp string
        const lastLiveDiscordTimestamp = lastLiveTimestamp
          ? `<t:${lastLiveTimestamp}:R>`
          : "Never";
        return (
          `${index + 1}. **${streamer.name}** on **${streamer.platform}**` +
          ` (Notifications in <#${streamer.channelID}>). Last live: ${lastLiveDiscordTimestamp}`
        );
      })
      .join("\n");

    const embed = createEmbed({
      title: "Tracked Streamers",
      description: streamersListString,
    });
    await interaction.followUp({ embeds: [embed] });
  }
};

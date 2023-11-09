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

    // Only include "Last live" information if the streamer is currently live
    const streamersListString = streamers
      .map((streamer, index) => {
        const statusInfo = streamer.isLive
          ? `Last live: <t:${Math.floor(new Date(streamer.startedAt).getTime() / 1000)}:R>`
          : "";

        return (
          `${index + 1}. **${streamer.name}** on **${streamer.platform}**` +
          ` (Notifications in <#${streamer.channelID}>)${statusInfo}`
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

// src/commands/social/removestreamer.js
const { Command } = require("@sapphire/framework");
const { guildSettings } = require("../../../db");
const { createEmbed } = require("../../utils/embed");

module.exports = class RemoveStreamerCommand extends Command {
  constructor(context, options) {
    super(context, {
      ...options,
      name: "removestreamer",
      description: "Remove a streamer from tracking.",
    });
  }

  async registerApplicationCommands(registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("The name of the streamer to remove")
            .setRequired(true)
        )
    );
  }

  async chatInputRun(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member.permissions.has("MANAGE_CHANNELS")) {
      const embed = createEmbed({
        description: "❌ You don't have permission to use this command.",
      });
      return interaction.followUp({ embeds: [embed] });
    }

    const guildId = interaction.guildId;
    const name = interaction.options.getString("name");
    const streamers = guildSettings.get(guildId, "streamers", []);

    const streamerIndex = streamers.findIndex(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );

    if (streamerIndex === -1) {
      const embed = createEmbed({
        description: `❌ Streamer ${name} was not found in the tracking list.`,
      });
      return interaction.followUp({ embeds: [embed] });
    }

    streamers.splice(streamerIndex, 1);
    guildSettings.set(guildId, "streamers", streamers);

    const embed = createEmbed({
      description: `✅ Successfully removed ${name} from the tracking list.`,
    });
    await interaction.followUp({ embeds: [embed] });
  }
};

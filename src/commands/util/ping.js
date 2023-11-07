// src/commands/admin/ping.js
const { Command } = require("@sapphire/framework");
const { createEmbed } = require("../../utils/embed");

module.exports = class PingCommand extends Command {
  constructor(context, options) {
    super(context, {
      ...options,
      name: "ping",
      description: "Measure the bot's response time in milliseconds.",
    });
  }

  async registerApplicationCommands(registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description)
    );
  }

  async chatInputRun(interaction) {
    const msg = await interaction.reply({
      content: "Pinging...",
      fetchReply: true,
    });
    const latency = msg.createdTimestamp - interaction.createdTimestamp;
    const embed = createEmbed({
      description: `🏓 Pong! Latency is ${latency}ms.`,
    });
    await interaction.editReply({ embeds: [embed] });
  }
};

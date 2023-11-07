// src/commands/util/help.js
const { Command } = require("@sapphire/framework");
const { MessageActionRow, MessageSelectMenu } = require("discord.js");
const { createEmbed } = require("../../utils/embed");

module.exports = class HelpCommand extends Command {
  constructor(context, options) {
    super(context, {
      ...options,
      name: "help",
      description: "Displays information about available commands.",
    });
  }

  async registerApplicationCommands(registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description)
    );
  }

  async chatInputRun(interaction) {
    const allCommands = [...this.container.stores.get("commands").values()];

    const isAdmin = interaction.member.permissions.has("ADMINISTRATOR");
    const commands = isAdmin
      ? allCommands
      : allCommands.filter((cmd) => cmd.category !== "admin");

    const selectMenu = new MessageSelectMenu()
      .setCustomId("help-select")
      .setPlaceholder("Select a command for more info")
      .addOptions(
        commands.map((cmd) => ({
          label: cmd.name,
          value: cmd.name,
          description: cmd.description,
        }))
      );

    const row = new MessageActionRow().addComponents(selectMenu);

    const embed = createEmbed({
      title: "📚 Help Panel",
      description: "Select a command from the dropdown for more information.",
    });

    const initialReply = await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    const filter = (i) => i.customId === "help-select";

    const collector = interaction.channel.createMessageComponentCollector({
      filter,
      componentType: "SELECT_MENU",
      time: 60000,
    });

    collector.on("collect", async (menuInteraction) => {
      const selectedCommandName = menuInteraction.values[0];
      const selectedCommand = commands.find(
        (cmd) => cmd.name === selectedCommandName
      );

      if (selectedCommand) {
        const updatedEmbed = createEmbed({
          title: `📚 ${selectedCommand.name}`,
          description: selectedCommand.description,
        });

        await menuInteraction.update({
          embeds: [updatedEmbed],
          components: [row],
        });
      }
    });

    collector.on("end", () => {
      interaction.editReply({
        components: [],
      });
    });
  }
};

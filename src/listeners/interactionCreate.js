// src/interaction-handlers/interactionCreate.js
const { Listener } = require("@sapphire/framework");
const config = require("../../config.json");
const { createEmbed } = require("../utils/embed");

module.exports = class extends Listener {
  constructor(context, options) {
    super(context, {
      ...options,
      name: "interactionCreate",
    });
  }

  async run(interaction) {
    try {
      if (!interaction.isMessageComponent()) return;
    } catch (error) {
      console.error("An error occurred:", error);
      const errorEmbed = createEmbed(
        "An error occurred",
        "Please try again later.",
        config.footer
      );
      interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
};

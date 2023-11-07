// src/utils/confirm.js
const { MessageActionRow, MessageButton } = require("discord.js");

const confirm = async (interaction, prompt) => {
  const row = new MessageActionRow().addComponents(
    new MessageButton()
      .setCustomId("confirm_yes")
      .setLabel("Yes")
      .setStyle("SUCCESS"),
    new MessageButton()
      .setCustomId("confirm_no")
      .setLabel("No")
      .setStyle("DANGER")
  );

  await interaction.followUp({ content: prompt, components: [row] });

  const filter = (i) => {
    i.deferUpdate();
    return i.customId === "confirm_yes" || i.customId === "confirm_no";
  };

  return new Promise((resolve) => {
    const collector = interaction.channel.createMessageComponentCollector({
      filter,
      time: 30000,
    });

    collector.on("collect", (i) => {
      resolve(i.customId === "confirm_yes");
      collector.stop();
    });

    collector.on("end", () => {
      resolve(false);
    });
  });
};

module.exports = confirm;

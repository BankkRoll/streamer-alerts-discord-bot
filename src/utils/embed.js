// src/utils/createEmbed.js
const { MessageEmbed } = require("discord.js");
const config = require("../../config.json");

module.exports.createEmbed = (options = {}) => {
  if (!options || Object.keys(options).length === 0) {
    return new MessageEmbed();
  }

  const embed = new MessageEmbed();

  embed.setColor(config.color || "DEFAULT");

  if (options.title) embed.setTitle(options.title);

  if (options.description) embed.setDescription(options.description);

  if (options.url) embed.setURL(options.url);

  if (options.fields) embed.addFields(options.fields);

  if (options.author) {
    embed.setAuthor({
      name: options.author.name,
      iconURL: options.author.icon,
      url: options.author.url,
    });
  }

  if (options.thumbnail) embed.setThumbnail(options.thumbnail);

  if (options.image) embed.setImage(options.image);

  if (options.video) embed.setVideo(options.video);

  if (config.footerText || config.footerIcon) {
    embed.setFooter({
      text: config.footerText || "",
      iconURL: config.footerIcon || undefined,
    });
  }

  if (options.timestamp) {
    embed.setTimestamp(new Date());
  }

  return embed;
};

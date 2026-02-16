import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { getCommandData } from '../src/commands/index.js';

/**
 * Deploy slash commands to Discord
 */
async function deploy(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  if (!token) {
    console.error('❌ DISCORD_TOKEN is not set');
    process.exit(1);
  }

  if (!clientId) {
    console.error('❌ CLIENT_ID is not set');
    process.exit(1);
  }

  const commands = getCommandData();
  const rest = new REST().setToken(token);

  try {
    console.log(`🔄 Deploying ${commands.length} commands...`);

    if (guildId) {
      // Guild-specific deployment (instant)
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`✅ Deployed to guild ${guildId}`);
    } else {
      // Global deployment (takes up to 1 hour)
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log('✅ Deployed globally (may take up to 1 hour to propagate)');
    }

    console.log('\nCommands deployed:');
    commands.forEach(cmd => {
      console.log(`  • /${cmd.name} - ${cmd.description}`);
    });
  } catch (error) {
    console.error('❌ Failed to deploy commands:', error);
    process.exit(1);
  }
}

deploy();

// Slash command registration for the Discord bot.
// Guild-scoped commands register instantly; global commands take ~1h to propagate.
// For a single-server bot, guild-scoped is the right choice.

import { SlashCommandBuilder, Routes } from 'discord.js';
import { REST } from 'discord.js';

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Run the setup wizard to create scanner channels (admin only).'),
  new SlashCommandBuilder()
    .setName('recent')
    .setDescription('Show the 5 most recent calls.'),
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search transcripts, talkgroups, and descriptions.')
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Search term (substring match)')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Tear down the scanner voice channel (admin only).'),
].map(c => c.toJSON());

export async function registerCommandsForGuild(client, guildId) {
  const rest = new REST({ version: '10' }).setToken(client.token);
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: COMMANDS });
}

export { COMMANDS };

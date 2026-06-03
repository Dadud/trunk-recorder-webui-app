// Discord bot role: post call embeds, optional voice channel
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDb, getCallsSince, getCallById, matchKeywords, recordPosted, addKeyword, removeKeyword, listKeywords } from '../lib/db.js';

function buildEmbed(call) {
  const embed = new EmbedBuilder()
    .setTitle(`${call.talkgroup_tag || 'Unknown'} — ${call.talkgroup_description || ''}`)
    .setColor(0x1d4ed8)
    .setTimestamp(new Date(call.recorded_at))
    .addFields(
      { name: 'Frequency', value: `${(call.freq / 1e6).toFixed(4)} MHz`, inline: true },
      { name: 'Length', value: `${call.call_length?.toFixed(1) || '?'}s`, inline: true },
      { name: 'Channel', value: call.short_name || '?', inline: true },
    );
  if (call.transcript_text && call.transcript_text.trim()) {
    const trimmed = call.transcript_text.length > 900 ? call.transcript_text.slice(0, 900) + '…' : call.transcript_text;
    embed.addFields({ name: 'Transcript', value: trimmed || '(empty)' });
  } else {
    embed.addFields({ name: 'Transcript', value: '_(pending or unavailable)_' });
  }
  return embed;
}

function buildListenButton(callId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`listen:${callId}`)
      .setLabel('🔊 Listen in voice')
      .setStyle(ButtonStyle.Primary)
  );
}

export function startBot({ dbPath, token, postChannelId, alertChannelId, pollIntervalMs = 3000, voiceChannelId = null, log = console }) {
  if (!token) {
    log.warn('[bot] DISCORD_TOKEN not set, bot disabled');
    return { stop: () => {} };
  }
  const db = getDb(dbPath);
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates] });

  let lastSeenId = db.prepare('SELECT MAX(id) as m FROM posted_messages').get()?.m || 0;
  let totalPosted = 0;
  let alertCache = new Map(); // callId -> matched keywords (to avoid double alerts)

  client.once('ready', () => {
    log.info(`[bot] logged in as ${client.user.tag}`);
    if (postChannelId) {
      const ch = client.channels.cache.get(postChannelId);
      if (ch) log.info(`[bot] will post to #${ch.name}`);
      else log.warn(`[bot] post channel ${postChannelId} not found in cache`);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    const [action, ...rest] = interaction.customId.split(':');
    if (action === 'listen') {
      const callId = Number(rest[0]);
      const call = getCallById(db, callId);
      if (!call) return interaction.reply({ content: 'Call not found', ephemeral: true });
      if (!call.audio_path) return interaction.reply({ content: 'No audio file for this call', ephemeral: true });

      // Voice channel logic: only enabled if voiceChannelId is set
      if (voiceChannelId) {
        try {
          const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = await import('@discordjs/voice');
          const conn = joinVoiceChannel({ channelId: voiceChannelId, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator });
          const player = createAudioPlayer();
          const resource = createAudioResource(call.audio_path);
          conn.subscribe(player);
          player.play(resource);
          player.on(AudioPlayerStatus.Idle, () => conn.destroy());
          conn.on(VoiceConnectionStatus.Destroyed, () => {});
          await interaction.reply({ content: `🔊 Now playing call #${callId} (${call.talkgroup_tag})`, ephemeral: false });
        } catch (err) {
          log.warn(`[bot] voice error: ${err.message}`);
          await interaction.reply({ content: `🔊 Voice playback failed: ${err.message}. File: ${call.audio_path}`, ephemeral: true });
        }
      } else {
        // Voice not configured, just reply with the file path
        await interaction.reply({ content: `🔊 Voice channel not configured. Audio file: \`${call.audio_path}\``, ephemeral: true });
      }
    }
  });

  client.login(token);

  // Poll for new calls
  const handle = setInterval(async () => {
    if (!client.isReady() || !postChannelId) return;
    try {
      const newCalls = getCallsSince(db, lastSeenId, 10);
      for (const call of newCalls) {
        if (call.id <= lastSeenId) continue;
        const channel = await client.channels.fetch(postChannelId).catch(() => null);
        if (!channel) continue;
        const embed = buildEmbed(call);
        const row = call.audio_path ? buildListenButton(call.id) : null;
        const msgOpts = { embeds: [embed] };
        if (row) msgOpts.components = [row];
        // Attach audio if small enough (<8MB for non-nitro)
        if (call.audio_path && call.audio_size && call.audio_size < 8 * 1024 * 1024) {
          const { AttachmentBuilder } = await import('discord.js');
          msgOpts.files = [new AttachmentBuilder(call.audio_path)];
        }
        const msg = await channel.send(msgOpts);
        recordPosted(db, call.id, msg.id, postChannelId);
        lastSeenId = Math.max(lastSeenId, call.id);
        totalPosted++;
        log.info(`[bot] posted call #${call.id} (${call.talkgroup_tag})`);

        // Keyword alerts
        if (alertChannelId && call.transcript_text) {
          const matches = matchKeywords(db, call.transcript_text);
          const fresh = matches.filter(k => !alertCache.has(`${call.id}:${k.id}`));
          for (const k of fresh) {
            alertCache.set(`${call.id}:${k.id}`, true);
            const alertCh = await client.channels.fetch(alertChannelId).catch(() => null);
            if (alertCh) {
              const alertEmbed = new EmbedBuilder()
                .setTitle(`🚨 Keyword alert: ${k.pattern}`)
                .setColor(0xdc2626)
                .setDescription(`Matched in call #${call.id} (${call.talkgroup_tag})\n\n${call.transcript_text.slice(0, 500)}`)
                .setTimestamp(new Date(call.recorded_at));
              await alertCh.send({ content: k.role_id ? `<@&${k.role_id}>` : null, embeds: [alertEmbed] });
            }
          }
          // Cap cache size
          if (alertCache.size > 1000) {
            const keys = Array.from(alertCache.keys()).slice(0, 500);
            keys.forEach(k => alertCache.delete(k));
          }
        }
      }
    } catch (err) {
      log.warn(`[bot] poll error: ${err.message}`);
    }
  }, pollIntervalMs);

  return {
    stop: () => { clearInterval(handle); client.destroy(); },
    get totalPosted() { return totalPosted; },
    addKeyword: (p, c, r) => addKeyword(db, p, c, r),
    removeKeyword: (id) => removeKeyword(db, id),
    listKeywords: () => listKeywords(db),
  };
}

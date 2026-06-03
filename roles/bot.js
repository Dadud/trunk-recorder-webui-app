// Discord bot role: post call embeds, optional voice channel, /setup wizard,
// /recent, /search, keyword alerts, multi-channel routing.
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { getDb, getCallsSince, getCallById, matchKeywords, recordPosted, listKeywords, addKeyword } from '../lib/db.js';
import { DEFAULT_KEYWORDS, shouldPageKeyword } from '../lib/keywords-defaults.js';
import {
  getWizardState, setWizardState, clearWizardState,
  buildSetupWelcome, buildVisibilityStep, buildNotableStep, buildVoiceStep, buildConfirmStep,
  executeSetup, userCanSetup, LAYOUTS, VISIBILITY,
} from '../lib/setup.js';

function readGuildConfig(rootConfig, guildId) {
  return rootConfig.scanner?.guilds?.[guildId] || null;
}

function writeGuildConfig(rootConfig, guildId, partial) {
  if (!rootConfig.scanner) rootConfig.scanner = {};
  if (!rootConfig.scanner.guilds) rootConfig.scanner.guilds = {};
  rootConfig.scanner.guilds[guildId] = { ...(rootConfig.scanner.guilds[guildId] || {}), ...partial };
  return rootConfig;
}

function buildCallEmbed(call) {
  const embed = new EmbedBuilder()
    .setTitle(`${call.talkgroup_tag || 'Unknown'} — ${call.talkgroup_description || ''}`)
    .setColor(0x1d4ed8)
    .setTimestamp(new Date(call.recorded_at))
    .addFields(
      { name: 'Frequency', value: `${(call.freq / 1e6).toFixed(4)} MHz`, inline: true },
      { name: 'Length', value: `${call.call_length?.toFixed(1) || '?'}s`, inline: true },
      { name: 'Channel', value: call.short_name || '?', inline: true },
    );
  // Tone detection field, if present
  if (call.tones && call.tones.length > 0) {
    const t = call.tones[0];
    embed.addFields({ name: '🚨 Tone', value: `**${t.department || 'Detected'}** (${t.tone_a_hz}Hz → ${t.tone_b_hz}Hz)`, inline: false });
  }
  if (call.transcript_text && call.transcript_text.trim()) {
    const trimmed = call.transcript_text.length > 900 ? call.transcript_text.slice(0, 900) + '…' : call.transcript_text;
    embed.addFields({ name: 'Transcript', value: trimmed || '(empty)' });
  } else {
    embed.addFields({ name: 'Transcript', value: '_(pending or unavailable)_' });
  }
  return embed;
}

function buildNotableEmbed(call, matchedKeyword) {
  const embed = new EmbedBuilder()
    .setTitle(`🚨 NOTABLE — ${call.talkgroup_tag || 'Unknown'}`)
    .setColor(0xdc2626)
    .setTimestamp(new Date(call.recorded_at))
    .setDescription([
      `**Matched keyword:** \`${matchedKeyword.pattern}\``,
      `**${matchedKeyword.description || ''}**`,
      '',
      call.transcript_text ? `> ${call.transcript_text.slice(0, 500)}` : '_(transcript pending)_',
    ].join('\n'))
    .addFields(
      { name: 'Talkgroup', value: call.talkgroup_description || call.talkgroup_tag || '?', inline: true },
      { name: 'Frequency', value: `${(call.freq / 1e6).toFixed(4)} MHz`, inline: true },
      { name: 'Length', value: `${call.call_length?.toFixed(1) || '?'}s`, inline: true },
    );
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

// Decide which Discord channel a call should go to, given the guild's layout config.
// Returns the channel ID or null if there's no configured destination.
function routeCallToChannel(call, guildCfg) {
  if (!guildCfg) return null;
  if (guildCfg.layout === 'single') {
    return guildCfg.textChannels?.find(c => c.kind === 'all')?.id || guildCfg.postChannelId || null;
  }
  if (guildCfg.layout === 'grouped') {
    const group = (call.talkgroup_group || 'Other').toLowerCase();
    const ch = guildCfg.textChannels?.find(c => c.kind === 'group' && c.group?.toLowerCase() === group);
    if (ch) return ch.id;
    return guildCfg.textChannels?.find(c => c.kind === 'group' && c.group?.toLowerCase() === 'other')?.id || null;
  }
  if (guildCfg.layout === 'multi') {
    const ch = guildCfg.textChannels?.find(c => c.kind === 'talkgroup' && Number(c.talkgroup) === Number(call.talkgroup));
    return ch?.id || null;
  }
  return guildCfg.postChannelId || null;
}

export function startBot({ dbPath, token, rootConfigPath, postChannelId, alertChannelId, voiceChannelId, pollIntervalMs = 3000, requireAudio = true, log = console, writeConfig }) {
  if (!token) {
    log.warn('[bot] DISCORD_TOKEN not set, bot disabled');
    return { stop: () => {} };
  }
  if (!writeConfig) {
    log.warn('[bot] no writeConfig function provided, wizard persistence disabled');
  }
  const db = getDb(dbPath);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  let lastSeenId = db.prepare('SELECT MAX(id) as m FROM posted_messages').get()?.m || 0;
  let totalPosted = 0;
  const alertCache = new Map();
  const notableCache = new Map();

  // Per-guild setup completion status, read on guildCreate/post time
  function getRootConfig() {
    if (!rootConfigPath) return { scanner: { guilds: {} } };
    try {
      const fs = require('fs');
      return JSON.parse(fs.readFileSync(rootConfigPath, 'utf8'));
    } catch { return { scanner: { guilds: {} } }; }
  }
  function saveRootConfig(cfg) {
    if (!rootConfigPath || !writeConfig) return;
    try {
      const fs = require('fs');
      fs.writeFileSync(rootConfigPath, JSON.stringify(cfg, null, 2));
    } catch (err) { log.warn(`[bot] failed to persist config: ${err.message}`); }
  }

  // discord.js v14 uses 'ready'; v15 renames to 'clientReady'. We're on v14.26.4
  // so 'ready' is correct. Switch the literal when bumping the lib.
  const onReady = 'ready';
  client.once(onReady, async () => {
    log.info(`[bot] logged in as ${client.user.tag}`);
    // Register slash commands globally (Discord caches for up to 1h, but guild commands are instant)
    // For dev we'll use guild-scoped commands for the first connected guild.
    const firstGuild = client.guilds.cache.first();
    if (firstGuild) {
      try {
        const { registerCommandsForGuild } = await import('../lib/commands.js');
        await registerCommandsForGuild(client, firstGuild.id);
        log.info(`[bot] registered slash commands for guild ${firstGuild.name} (${firstGuild.id})`);
      } catch (err) { log.warn(`[bot] command registration failed: ${err.message}`); }
    }
  });

  // On join, post a welcome message in the system channel
  client.on('guildCreate', async (guild) => {
    log.info(`[bot] joined guild ${guild.name} (${guild.id}), ${guild.memberCount} members`);
    try {
      const { registerCommandsForGuild } = await import('../lib/commands.js');
      await registerCommandsForGuild(client, guild.id);
    } catch (err) { log.warn(`[bot] command register on join failed: ${err.message}`); }
    const sysChannel = guild.systemChannel;
    if (sysChannel) {
      const embed = new EmbedBuilder()
        .setTitle('📡 Scanner Bot ready')
        .setDescription([
          'Hi! I post scanner calls (audio + transcripts) from your trunk recorder into Discord.',
          '',
          'An admin needs to run `/setup` to create the channels. The wizard is one click per question.',
          '',
          '`/recent` — last 5 calls',
          '`/search <term>` — search transcripts',
          '`/setup` — create/refresh channels',
        ].join('\n'))
        .setColor(0x1d4ed8);
      sysChannel.send({ embeds: [embed] }).catch(() => {});
    }
  });

  // ─── Slash command handler ────────────────────────────────────────────────
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await handleButton(interaction);
      }
    } catch (err) {
      log.warn(`[bot] interaction error: ${err.message}`);
      try { await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true }); } catch {}
    }
  });

  async function handleSlashCommand(interaction) {
    const { commandName } = interaction;

    if (commandName === 'setup') {
      if (!userCanSetup(interaction.member)) {
        return interaction.reply({ content: 'You need **Manage Channels** and **Manage Roles** to run setup.', ephemeral: true });
      }
      // Start the wizard
      setWizardState(interaction.guildId, interaction.user.id, { step: 'layout' });
      const msg = buildSetupWelcome();
      return interaction.reply({ ...msg, ephemeral: true });
    }

    if (commandName === 'recent') {
      const calls = db.prepare(`
        SELECT c.*, t.text as transcript_text
        FROM calls c LEFT JOIN transcripts t ON t.call_id = c.id
        ORDER BY c.recorded_at DESC LIMIT 5
      `).all();
      if (calls.length === 0) return interaction.reply({ content: 'No calls yet.', ephemeral: true });
      const embeds = calls.map(c => buildCallEmbed(c).setFooter({ text: `ID ${c.id} · ${new Date(c.recorded_at).toLocaleString()}` }));
      return interaction.reply({ embeds, ephemeral: true });
    }

    if (commandName === 'search') {
      const q = interaction.options.getString('query', true);
      const calls = db.prepare(`
        SELECT c.*, t.text as transcript_text
        FROM calls c LEFT JOIN transcripts t ON t.call_id = c.id
        WHERE t.text LIKE ? OR c.talkgroup_tag LIKE ? OR c.talkgroup_description LIKE ?
        ORDER BY c.recorded_at DESC LIMIT 10
      `).all(`%${q}%`, `%${q}%`, `%${q}%`);
      if (calls.length === 0) return interaction.reply({ content: `No matches for "${q}".`, ephemeral: true });
      const embeds = calls.map(c => buildCallEmbed(c).setFooter({ text: `ID ${c.id} · ${new Date(c.recorded_at).toLocaleString()}` }));
      return interaction.reply({ content: `Found ${calls.length} match(es) for "${q}":`, embeds, ephemeral: true });
    }

    if (commandName === 'close') {
      // Tear down the voice channel
      const cfg = readGuildConfig(getRootConfig(), interaction.guildId);
      if (!cfg?.voiceChannelId) return interaction.reply({ content: 'No voice channel configured.', ephemeral: true });
      const ch = interaction.guild.channels.cache.get(cfg.voiceChannelId);
      if (!ch) return interaction.reply({ content: 'Voice channel not found (already deleted?).', ephemeral: true });
      await ch.delete('Scanner bot /close command');
      saveRootConfig(writeGuildConfig(getRootConfig(), interaction.guildId, { voiceChannelId: null }));
      return interaction.reply({ content: '🗑️ Voice channel removed.', ephemeral: true });
    }

    if (commandName === 'teardown') {
      if (!userCanSetup(interaction.member)) {
        return interaction.reply({ content: 'You need **Manage Channels** to run teardown.', ephemeral: true });
      }
      const scannerCats = interaction.guild.channels.cache.filter(c =>
        c.type === ChannelType.GuildCategory && /scanner/i.test(c.name)
      );
      if (scannerCats.size === 0) {
        return interaction.reply({ content: 'No Scanner categories found.', ephemeral: true });
      }
      // Find empty categories (no channels inside) — those are safe to delete.
      // We keep the one with the most populated children (the active one).
      const candidates = scannerCats.map(cat => {
        const children = interaction.guild.channels.cache.filter(c => c.parentId === cat.id);
        return { cat, children, count: children.size };
      }).sort((a, b) => b.count - a.count);

      const active = candidates[0];
      const toDelete = candidates.slice(1).filter(c => c.count === 0); // only delete empty ones

      const lines = [
        `Found **${scannerCats.size}** Scanner categories.`,
        `Active (will keep): **${active.cat.name}** with ${active.count} channel(s).`,
        '',
        `Empty duplicates that will be removed: **${toDelete.length}**`,
        ...toDelete.slice(0, 10).map(c => `• \`${c.cat.name}\` (id ${c.cat.id})`),
        toDelete.length > 10 ? `… and ${toDelete.length - 10} more` : '',
        '',
        'Click **Delete** to confirm. The active category is preserved.',
      ].filter(Boolean);

      const row = {
        type: 1,
        components: toDelete.length > 0 ? [
          { type: 2, custom_id: 'teardown:confirm', label: '🗑️ Delete duplicates', style: 4 },
          { type: 2, custom_id: 'teardown:cancel', label: 'Cancel', style: 2 },
        ] : [{ type: 2, custom_id: 'teardown:cancel', label: 'Nothing to delete', style: 2, disabled: true }],
      };
      return interaction.reply({ content: lines.join('\n'), components: [row], ephemeral: true });
    }
  }

  async function handleButton(interaction) {
    const [ns, action, value] = interaction.customId.split(':');
    if (ns === 'teardown') return handleTeardownButton(interaction);
    if (ns !== 'setup') return handleListenButton(interaction);
    const state = getWizardState(interaction.guildId, interaction.user.id) || {};
    if (action === 'layout') {
      state.layout = value;
      state.step = 'visibility';
      setWizardState(interaction.guildId, interaction.user.id, state);
      return interaction.update(buildVisibilityStep(value));
    }
    if (action === 'visibility') {
      state.visibility = value;
      state.step = 'notable';
      setWizardState(interaction.guildId, interaction.user.id, state);
      return interaction.update(buildNotableStep(state.layout, value));
    }
    if (action === 'notable') {
      state.notable = value;
      state.step = 'voice';
      setWizardState(interaction.guildId, interaction.user.id, state);
      return interaction.update(buildVoiceStep(state.layout, state.visibility, value));
    }
    if (action === 'voice') {
      state.voice = value;
      state.step = 'confirm';
      setWizardState(interaction.guildId, interaction.user.id, state);
      return interaction.update(buildConfirmStep(state));
    }
    if (action === 'confirm') {
      if (value === 'no') {
        clearWizardState(interaction.guildId, interaction.user.id);
        return interaction.update({ content: 'Setup cancelled.', embeds: [], components: [] });
      }
      // Execute
      await interaction.deferUpdate();
      try {
        const result = await executeSetup(interaction.guild, state, getRootConfig(), dbPath);

        // ─── Save config FIRST, before seeding keywords. ──────────────────────
        // A failure in keyword seeding (e.g. transient DB error) must not
        // roll back the channel creation, which is the expensive part.
        const guildCfg = {
          setupComplete: true,
          setupAt: new Date().toISOString(),
          layout: state.layout,
          visibility: state.visibility,
          notable: state.notable === 'yes',
          voice: state.voice === 'yes',
          roleId: result.roleId,
          categoryId: result.categoryId,
          textChannels: result.textChannels,
          notableChannelId: result.notableChannelId,
          voiceChannelId: result.voiceChannelId,
        };
        saveRootConfig(writeGuildConfig(getRootConfig(), interaction.guildId, guildCfg));
        clearWizardState(interaction.guildId, interaction.user.id);

        // Seed default keywords (after config is saved; failure here is non-fatal)
        let seeded = 0;
        let seedError = null;
        if (state.notable === 'yes' && result.notableChannelId) {
          try {
            for (const k of DEFAULT_KEYWORDS) {
              addKeyword(db, k.pattern, result.notableChannelId, null);
              seeded++;
            }
          } catch (err) {
            seedError = err.message;
            log.warn(`[bot] keyword seeding failed (non-fatal): ${err.message}`);
          }
        }

        const summary = new EmbedBuilder()
          .setTitle('✅ Scanner Bot setup complete')
          .setColor(0x16a34a)
          .setDescription([
            `**Layout:** ${LAYOUTS[state.layout].emoji} ${LAYOUTS[state.layout].label}`,
            `**Visibility:** ${VISIBILITY[state.visibility].emoji} ${VISIBILITY[state.visibility].label}`,
            `**Notable channel:** ${state.notable === 'yes' ? '✅' : '❌'}`,
            `**Voice channel:** ${state.voice === 'yes' ? '✅' : '❌'}`,
            '',
            result.roleId ? `Scanner role: <@&${result.roleId}>` : '',
            `Category: <#${result.categoryId}>`,
            '',
            '**Text channels created:**',
            ...result.textChannels.map(c => `• <#${c.id}>`),
            result.notableChannelId ? `\n**Notable:** <#${result.notableChannelId}> (seeded with ${seeded} default keywords${seedError ? `, seeding error: ${seedError}` : ''})` : '',
            result.voiceChannelId ? `\n**Voice:** <#${result.voiceChannelId}>` : '',
            '',
            'You can re-run `/setup` any time to change the layout.',
          ].filter(Boolean).join('\n'))
          .setTimestamp();
        return interaction.editReply({ embeds: [summary], components: [] });
      } catch (err) {
        log.error(`[bot] setup failed: ${err.message}\n${err.stack}`);
        return interaction.editReply({ content: `❌ Setup failed: ${err.message}`, embeds: [], components: [] });
      }
    }
  }

  async function handleTeardownButton(interaction) {
    const [ns, action] = interaction.customId.split(':');
    if (action === 'cancel') {
      return interaction.update({ content: 'Teardown cancelled.', embeds: [], components: [] });
    }
    if (action === 'confirm') {
      await interaction.deferUpdate();
      const scannerCats = interaction.guild.channels.cache.filter(c =>
        c.type === ChannelType.GuildCategory && /scanner/i.test(c.name)
      );
      const candidates = scannerCats.map(cat => {
        const children = interaction.guild.channels.cache.filter(c => c.parentId === cat.id);
        return { cat, count: children.size };
      }).sort((a, b) => b.count - a.count);
      const toDelete = candidates.slice(1).filter(c => c.count === 0);

      let deleted = 0;
      const errors = [];
      for (const c of toDelete) {
        try {
          await c.cat.delete('Scanner bot /teardown: removing duplicate empty Scanner category');
          deleted++;
        } catch (err) {
          errors.push(`${c.cat.name}: ${err.message}`);
        }
      }
      const lines = [
        deleted > 0 ? `🗑️ Deleted ${deleted} empty Scanner categor${deleted === 1 ? 'y' : 'ies'}.` : 'No categories were deleted.',
        errors.length > 0 ? `\nErrors:\n${errors.map(e => `• ${e}`).join('\n')}` : '',
        '\nYou can re-run `/setup` to populate the remaining category with channels.',
      ].filter(Boolean).join('\n');
      return interaction.editReply({ content: lines, components: [] });
    }
  }

  async function handleListenButton(interaction) {
    const [action, ...rest] = interaction.customId.split(':');
    if (action !== 'listen') return;
    const callId = Number(rest[0]);
    const call = getCallById(db, callId);
    if (!call) return interaction.reply({ content: 'Call not found', ephemeral: true });
    if (!call.audio_path) return interaction.reply({ content: 'No audio file for this call', ephemeral: true });
    const cfg = readGuildConfig(getRootConfig(), interaction.guildId);
    const vcId = cfg?.voiceChannelId || voiceChannelId;
    if (!vcId) {
      return interaction.reply({ content: `🔊 Voice channel not configured. Audio file: \`${call.audio_path}\``, ephemeral: true });
    }
    try {
      const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = await import('@discordjs/voice');
      const conn = joinVoiceChannel({ channelId: vcId, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator });
      const player = createAudioPlayer();
      const resource = createAudioResource(call.audio_path);
      conn.subscribe(player);
      player.play(resource);
      player.on(AudioPlayerStatus.Idle, () => conn.destroy());
      await interaction.reply({ content: `🔊 Now playing call #${callId} (${call.talkgroup_tag})`, ephemeral: false });
    } catch (err) {
      log.warn(`[bot] voice error: ${err.message}`);
      await interaction.reply({ content: `🔊 Voice playback failed: ${err.message}. File: \`${call.audio_path}\``, ephemeral: true });
    }
  }

  // ─── Call post loop ──────────────────────────────────────────────────────
  const handle = setInterval(async () => {
    if (!client.isReady()) return;
    try {
      const newCalls = getCallsSince(db, lastSeenId, 10);
      for (const call of newCalls) {
        if (call.id <= lastSeenId) continue;
        // Skip calls that have no audio file (text-only calls aren't useful to post).
        // Can be disabled with requireAudio=false for setups where audio is suppressed.
        if (requireAudio && !call.audio_path) {
          // Still advance lastSeenId so we don't loop on the same row forever
          lastSeenId = Math.max(lastSeenId, call.id);
          continue;
        }

        // For each guild we're in, post if routing matches
        for (const [guildId, guild] of client.guilds.cache) {
          const cfg = readGuildConfig(getRootConfig(), guildId);
          if (!cfg) continue; // not set up yet
          if (!cfg.setupComplete) {
            // The bot's been invited but /setup never finished. Log once per
            // missing-config to help the operator notice, then skip.
            log.warn(`[bot] guild ${guild.name} (${guildId}) is invited but /setup incomplete; skipping calls until admin runs /setup`);
            continue;
          }
          if (!cfg.textChannels || cfg.textChannels.length === 0) {
            log.warn(`[bot] guild ${guild.name} (${guildId}) has setupComplete=true but no textChannels; re-run /setup`);
            continue;
          }
          const channelId = routeCallToChannel(call, cfg);
          if (!channelId) continue;
          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (!channel) continue;
          const embed = buildCallEmbed(call);
          const row = call.audio_path ? buildListenButton(call.id) : null;
          const msgOpts = { embeds: [embed] };
          if (row) msgOpts.components = [row];
          if (call.audio_path && call.audio_size && call.audio_size < 8 * 1024 * 1024) {
            const { AttachmentBuilder } = await import('discord.js');
            msgOpts.files = [new AttachmentBuilder(call.audio_path)];
          }
          const msg = await channel.send(msgOpts);
          recordPosted(db, call.id, msg.id, channelId);
          totalPosted++;
          log.info(`[bot] posted call #${call.id} (${call.talkgroup_tag}) to #${channel.name} in ${guild.name}`);
        }

        lastSeenId = Math.max(lastSeenId, call.id);

        // Notable-channel check (keyword + talkgroup-name guard)
        for (const [guildId, guild] of client.guilds.cache) {
          const cfg = readGuildConfig(getRootConfig(), guildId);
          if (!cfg?.notable || !cfg.notableChannelId) continue;
          const text = call.transcript_text || '';
          if (!text) continue;
          const keywords = listKeywords(db);
          for (const k of keywords) {
            const cacheKey = `${call.id}:${guildId}:${k.id}`;
            if (notableCache.has(cacheKey)) continue;
            if (shouldPageKeyword(k.pattern, call.talkgroup_tag, text)) {
              const ch = await client.channels.fetch(cfg.notableChannelId).catch(() => null);
              if (ch) {
                const embed = buildNotableEmbed(call, k);
                const ping = cfg.roleId ? `<@&${cfg.roleId}>` : null;
                await ch.send({ content: ping, embeds: [embed] });
                notableCache.set(cacheKey, true);
                log.info(`[bot] notable: call #${call.id} matched "${k.pattern}" in ${guild.name}`);
              }
            }
          }
          if (notableCache.size > 2000) {
            const keys = Array.from(notableCache.keys()).slice(0, 1000);
            keys.forEach(k => notableCache.delete(k));
          }
        }

        // Legacy alert channel (for non-notable-channel setups)
        if (alertChannelId && call.transcript_text) {
          const matches = matchKeywords(db, call.transcript_text);
          const fresh = matches.filter(k => !alertCache.has(`${call.id}:${k.id}`));
          for (const k of fresh) {
            alertCache.set(`${call.id}:${k.id}`, true);
            const alertCh = await client.channels.fetch(alertChannelId).catch(() => null);
            if (alertCh) {
              const embed = new EmbedBuilder()
                .setTitle(`🚨 Keyword alert: ${k.pattern}`)
                .setColor(0xdc2626)
                .setDescription(`Matched in call #${call.id} (${call.talkgroup_tag})\n\n${call.transcript_text.slice(0, 500)}`)
                .setTimestamp(new Date(call.recorded_at));
              await alertCh.send({ content: k.role_id ? `<@&${k.role_id}>` : null, embeds: [embed] });
            }
          }
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

  client.login(token).catch(err => log.error(`[bot] login failed: ${err.message}`));

  return {
    stop: () => { clearInterval(handle); client.destroy(); },
    get totalPosted() { return totalPosted; },
    get client() { return client; },
  };
}

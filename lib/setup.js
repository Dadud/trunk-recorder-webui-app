// /setup wizard: creates category, channels, role, voice channel, configures keywords.
// Each step is a button interaction; the wizard tracks state in a Map keyed by
// (guildId, userId). State is ephemeral and lost on bot restart — that's fine,
// re-running /setup re-does everything from scratch.

import { ChannelType, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { DEFAULT_KEYWORDS } from './keywords-defaults.js';
import { addKeyword } from './db.js';

const wizardState = new Map(); // key: `${guildId}:${userId}` -> state

function stateKey(guildId, userId) { return `${guildId}:${userId}`; }

export function getWizardState(guildId, userId) {
  return wizardState.get(stateKey(guildId, userId));
}

export function setWizardState(guildId, userId, state) {
  wizardState.set(stateKey(guildId, userId), state);
}

export function clearWizardState(guildId, userId) {
  wizardState.delete(stateKey(guildId, userId));
}

// Check that the inviter has admin-level permissions to create channels/roles
export function userCanSetup(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.ManageChannels) &&
         member.permissions.has(PermissionFlagsBits.ManageRoles);
}

const LAYOUTS = {
  single:   { label: 'Single channel',   emoji: '📡', description: 'All calls posted to one #scanner-calls feed.' },
  multi:    { label: 'Multi-channel',    emoji: '📻', description: 'One text channel per talkgroup, from channel.csv.' },
  grouped:  { label: 'Grouped by type',  emoji: '🏷️', description: 'One text channel per talkgroup_group (Fire, EMS, Law).' },
};

const VISIBILITY = {
  private:  { label: 'Private',  emoji: '🔒', description: 'Bot creates a Scanner role; only role can see channels.' },
  public:   { label: 'Public',   emoji: '🌍', description: 'Anyone in the server can see the channels.' },
};

export { LAYOUTS, VISIBILITY };

const VOICE = {
  yes: { label: 'Yes — create voice channel', emoji: '✅' },
  no:  { label: 'No — text only',              emoji: '❌' },
};

const NOTABLE = {
  yes: { label: 'Yes — create #scanner-notable with default keywords', emoji: '✅' },
  no:  { label: 'No — skip',                                         emoji: '❌' },
};

// ─── Step screens ──────────────────────────────────────────────────────────────

export function buildSetupWelcome() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('🛠️ Scanner Bot Setup')
      .setDescription('I\'ll walk you through creating the channels and roles. You can re-run `/setup` to change anything later.')
      .setColor(0x1d4ed8)],
    content: '**Step 1 of 4 — Pick a channel layout**',
    components: [buttonRow([
      ['setup:layout:single',  LAYOUTS.single],
      ['setup:layout:multi',   LAYOUTS.multi],
      ['setup:layout:grouped', LAYOUTS.grouped],
    ])],
  };
}

export function buildVisibilityStep(layout) {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('🛠️ Step 2 of 4 — Visibility')
      .setDescription('Should the scanner channels be private (role-gated) or public?')
      .setColor(0x1d4ed8)],
    content: `Layout: **${LAYOUTS[layout].emoji} ${LAYOUTS[layout].label}**`,
    components: [buttonRow([
      ['setup:visibility:private', VISIBILITY.private],
      ['setup:visibility:public',  VISIBILITY.public],
    ])],
  };
}

export function buildNotableStep(layout, visibility) {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('🛠️ Step 3 of 4 — Notable events channel')
      .setDescription([
        'A separate channel fed by keyword matching — fire pages, working fires, ',
        'shots-fired reports, etc. Default keyword list:',
        '',
        ...DEFAULT_KEYWORDS.map(k => `• \`${k.pattern}\` — ${k.description}`),
      ].join('\n'))
      .setColor(0x1d4ed8)],
    content: `Layout: **${LAYOUTS[layout].label}** · Visibility: **${VISIBILITY[visibility].label}**`,
    components: [buttonRow([
      ['setup:notable:yes', NOTABLE.yes],
      ['setup:notable:no',  NOTABLE.no],
    ])],
  };
}

export function buildVoiceStep(layout, visibility, notable) {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('🛠️ Step 4 of 4 — Voice channel')
      .setDescription('Create a `🔊 Scanner Live` voice channel the bot joins when you click 🔊 on a call?')
      .setColor(0x1d4ed8)],
    content: `Layout: **${LAYOUTS[layout].label}** · Visibility: **${VISIBILITY[visibility].label}** · Notable: **${notable === 'yes' ? '✅' : '❌'}**`,
    components: [buttonRow([
      ['setup:voice:yes', VOICE.yes],
      ['setup:voice:no',  VOICE.no],
    ])],
  };
}

export function buildConfirmStep(state) {
  const { layout, visibility, notable, voice } = state;
  const lines = [
    '**Ready to build. Confirm?**',
    '',
    `• Layout: **${LAYOUTS[layout].emoji} ${LAYOUTS[layout].label}** — ${LAYOUTS[layout].description}`,
    `• Visibility: **${VISIBILITY[visibility].emoji} ${VISIBILITY[visibility].label}**`,
    `• Notable channel: **${notable === 'yes' ? '✅ Yes' : '❌ No'}**`,
    `• Voice channel: **${voice === 'yes' ? '✅ Yes' : '❌ No'}**`,
  ];
  if (notable === 'yes') {
    lines.push('', `Will seed ${DEFAULT_KEYWORDS.length} default keywords.`);
  }
  return {
    embeds: [new EmbedBuilder().setTitle('🛠️ Confirm setup').setDescription(lines.join('\n')).setColor(0x1d4ed8)],
    components: [buttonRow([
      ['setup:confirm:yes', { label: '✅ Build it', emoji: null, style: 'primary' }],
      ['setup:confirm:no',  { label: '❌ Cancel',   emoji: null, style: 'secondary' }],
    ])],
  };
}

// ─── Build step ────────────────────────────────────────────────────────────────

// Build all the channels, role, etc. Returns a summary object the bot uses to
// post a confirmation message and persist config.
export async function executeSetup(guild, state, config, dbPath) {
  const { layout, visibility, notable, voice } = state;
  const everyone = guild.roles.everyone;
  const existingCfg = config?.scanner?.guilds?.[guild.id] || {};

  // ─── Idempotency: find existing artifacts before creating new ones ────────────
  // Helper: find an existing Scanner role, or null
  let scannerRole = existingCfg.roleId
    ? guild.roles.cache.get(existingCfg.roleId) || guild.roles.cache.find(r => r.name === 'Scanner')
    : guild.roles.cache.find(r => r.name === 'Scanner');

  // Helper: find an existing Scanner category by name (and known id if we have it)
  let category = existingCfg.categoryId
    ? guild.channels.cache.get(existingCfg.categoryId)
    : null;
  if (!category) {
    category = guild.channels.cache.find(c =>
      c.type === ChannelType.GuildCategory && /scanner/i.test(c.name)
    );
  }

  // Helper: find an existing channel by name under the (existing or new) category
  const findChannel = (name) => {
    if (!category) return null;
    return guild.channels.cache.find(c => c.parentId === category.id && c.name === name);
  };

  // ─── Step 1: ensure the role exists ──────────────────────────────────────────
  if (visibility === 'private' && !scannerRole) {
    scannerRole = await guild.roles.create({
      name: 'Scanner',
      reason: 'Scanner bot setup',
      permissions: [],
    });
  }

  // ─── Step 2: ensure the category exists ──────────────────────────────────────
  if (!category) {
    category = await guild.channels.create({
      name: '📡 Scanner',
      type: ChannelType.GuildCategory,
      permissionOverwrites: visibility === 'private' ? [
        { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: scannerRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
      ] : [],
    });
  }

  // ─── Step 3: ensure each text channel exists ────────────────────────────────
  const textChannels = [];
  const channelPlan = planChannels(layout);
  for (const ch of channelPlan) {
    let existing = findChannel(ch.name);
    if (!existing) {
      existing = await guild.channels.create({
        name: ch.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: ch.topic,
        permissionOverwrites: visibility === 'private' ? [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: scannerRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
        ] : [],
      });
    }
    textChannels.push({ name: existing.name, id: existing.id, talkgroup: ch.talkgroup || null, kind: ch.kind, group: ch.group || null });
  }

  // ─── Step 4: notable channel ─────────────────────────────────────────────────
  let notableChannel = null;
  if (notable === 'yes') {
    notableChannel = findChannel('scanner-notable');
    if (!notableChannel) {
      notableChannel = await guild.channels.create({
        name: 'scanner-notable',
        type: ChannelType.GuildText,
        parent: category.id,
        topic: 'Notable scanner events: structure fires, shots fired, working fires, etc.',
        permissionOverwrites: visibility === 'private' ? [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: scannerRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
        ] : [],
      });
    }
  }

  // ─── Step 5: voice channel ───────────────────────────────────────────────────
  let voiceChannel = null;
  if (voice === 'yes') {
    voiceChannel = findChannel('🔊 Scanner Live');
    if (!voiceChannel) {
      voiceChannel = await guild.channels.create({
        name: '🔊 Scanner Live',
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: visibility === 'private' ? [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: scannerRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
        ] : [],
      });
    }
  }

  return {
    roleId: scannerRole?.id || null,
    categoryId: category.id,
    textChannels,
    notableChannelId: notableChannel?.id || null,
    voiceChannelId: voiceChannel?.id || null,
  };
}

// Decide which text channels to create based on layout.
// For multi-channel layout, we need a talkgroup list — we pull it from
// the channel.csv via the webui config (the webui process reads it; the bot
// just trusts the config that was passed in).
function planChannels(layout) {
  if (layout === 'single') {
    return [{ name: 'scanner-calls', topic: 'All scanner calls', kind: 'all' }];
  }
  if (layout === 'grouped') {
    // Without channel.csv loaded here, default to the four common groups.
    // The webui can re-create with a real list if the operator wants.
    return [
      { name: 'fire',  topic: 'Fire dispatch (all counties)', kind: 'group', group: 'Fire' },
      { name: 'ems',   topic: 'EMS dispatch (all counties)',  kind: 'group', group: 'EMS' },
      { name: 'law',   topic: 'Law enforcement (all counties)', kind: 'group', group: 'Law' },
      { name: 'multi', topic: 'Multi-discipline dispatch',   kind: 'group', group: 'Multi' },
      { name: 'other', topic: 'Other scanner traffic',         kind: 'group', group: 'Other' },
    ];
  }
  // multi: one channel per talkgroup. We'd normally read this from channel.csv
  // via the webui. For now, the bot falls back to a generic set.
  return [
    { name: 'wood-fire',     topic: 'Wood County Fire Dispatch',     kind: 'talkgroup', talkgroup: 1 },
    { name: 'wood-ems',      topic: 'Wood County EMS Dispatch',      kind: 'talkgroup', talkgroup: 2 },
    { name: 'wood-so',       topic: 'Wood County Sheriff Dispatch',  kind: 'talkgroup', talkgroup: 3 },
    { name: 'clark-so',      topic: 'Clark County Sheriff Dispatch', kind: 'talkgroup', talkgroup: 5 },
    { name: 'clark-fire',    topic: 'Clark County Fire Dispatch',    kind: 'talkgroup', talkgroup: 6 },
    { name: 'clark-pd-ems',  topic: 'Clark County PD/EMS',           kind: 'talkgroup', talkgroup: 7 },
    { name: 'jack-so',       topic: 'Jackson County Sheriff',        kind: 'talkgroup', talkgroup: 8 },
    { name: 'jack-fire',     topic: 'Jackson County Fire',           kind: 'talkgroup', talkgroup: 9 },
    { name: 'main-dispatch', topic: 'Main Dispatch',                  kind: 'talkgroup', talkgroup: 10 },
  ];
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function buttonRow(buttons) {
  return {
    type: 1, // ActionRow
    components: buttons.map(([id, def]) => {
      const btn = { type: 2, custom_id: id, style: 1 }; // 1 = Primary, 2 = Secondary
      if (def.label) btn.label = def.label;
      if (def.emoji) btn.emoji = def.emoji;
      if (def.style === 'primary') btn.style = 1;
      if (def.style === 'secondary') btn.style = 2;
      if (def.style === 'success') btn.style = 3;
      if (def.style === 'danger') btn.style = 4;
      return btn;
    }),
  };
}

// SQLite store for scanner roles
// Tables: calls, transcripts, keywords, posted_messages
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db = null;

export function getDb(dbPath) {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_name TEXT NOT NULL,
      call_num INTEGER NOT NULL,
      freq INTEGER NOT NULL,
      talkgroup INTEGER,
      talkgroup_tag TEXT,
      talkgroup_description TEXT,
      talkgroup_group TEXT,
      call_length REAL,
      start_time INTEGER,
      stop_time INTEGER,
      audio_path TEXT,
      audio_size INTEGER,
      audio_format TEXT,
      sidecar_json TEXT,
      recorded_at TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(short_name, call_num, start_time)
    );
    CREATE INDEX IF NOT EXISTS idx_calls_recorded ON calls(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_calls_talkgroup ON calls(talkgroup);

    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
      text TEXT,
      language TEXT,
      duration REAL,
      segments TEXT,
      model TEXT,
      transcribed_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      channel_id TEXT,
      role_id TEXT,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS posted_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      posted_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);
  return db;
}

export function upsertCall(db, call) {
  const stmt = db.prepare(`
    INSERT INTO calls (
      short_name, call_num, freq, talkgroup, talkgroup_tag,
      talkgroup_description, talkgroup_group, call_length,
      start_time, stop_time, audio_path, audio_size, audio_format,
      sidecar_json, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(short_name, call_num, start_time) DO UPDATE SET
      audio_path = COALESCE(excluded.audio_path, calls.audio_path),
      audio_size = COALESCE(excluded.audio_size, calls.audio_size),
      audio_format = COALESCE(excluded.audio_format, calls.audio_format),
      sidecar_json = excluded.sidecar_json
  `);
  const info = stmt.run(
    call.short_name, call.call_num, call.freq, call.talkgroup, call.talkgroup_tag,
    call.talkgroup_description, call.talkgroup_group, call.call_length,
    call.start_time, call.stop_time, call.audio_path, call.audio_size, call.audio_format,
    call.sidecar_json, call.recorded_at
  );
  if (info.changes > 0 && info.lastInsertRowid) return info.lastInsertRowid;
  const existing = db.prepare('SELECT id FROM calls WHERE short_name = ? AND call_num = ? AND start_time = ?')
    .get(call.short_name, call.call_num, call.start_time);
  return existing?.id;
}

export function setTranscript(db, callId, transcript) {
  db.prepare(`
    INSERT INTO transcripts (call_id, text, language, duration, segments, model)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(call_id) DO UPDATE SET
      text = excluded.text,
      language = excluded.language,
      duration = excluded.duration,
      segments = excluded.segments,
      model = excluded.model,
      transcribed_at = strftime('%s', 'now')
  `).run(callId, transcript.text, transcript.language, transcript.duration,
         JSON.stringify(transcript.segments || []), transcript.model);
}

export function getUntranscribed(db, limit = 10) {
  return db.prepare(`
    SELECT c.* FROM calls c
    LEFT JOIN transcripts t ON t.call_id = c.id
    WHERE t.id IS NULL AND c.audio_path IS NOT NULL
    ORDER BY c.recorded_at ASC LIMIT ?
  `).all(limit);
}

export function getCallById(db, id) {
  return db.prepare(`
    SELECT c.*, t.text as transcript_text, t.language as transcript_language
    FROM calls c
    LEFT JOIN transcripts t ON t.call_id = c.id
    WHERE c.id = ?
  `).get(id);
}

export function getRecentCalls(db, limit = 50) {
  return db.prepare(`
    SELECT c.*, t.text as transcript_text, t.language as transcript_language
    FROM calls c
    LEFT JOIN transcripts t ON t.call_id = c.id
    ORDER BY c.recorded_at DESC LIMIT ?
  `).all(limit);
}

export function getCallsSince(db, sinceId = 0, limit = 100) {
  return db.prepare(`
    SELECT c.*, t.text as transcript_text, t.language as transcript_language
    FROM calls c
    LEFT JOIN transcripts t ON t.call_id = c.id
    WHERE c.id > ?
    ORDER BY c.id ASC LIMIT ?
  `).all(sinceId, limit);
}

export function searchCalls(db, query, limit = 50) {
  const q = `%${query}%`;
  return db.prepare(`
    SELECT c.*, t.text as transcript_text
    FROM calls c
    LEFT JOIN transcripts t ON t.call_id = c.id
    WHERE t.text LIKE ? OR c.talkgroup_tag LIKE ? OR c.talkgroup_description LIKE ?
    ORDER BY c.recorded_at DESC LIMIT ?
  `).all(q, q, q, limit);
}

export function matchKeywords(db, text) {
  if (!text) return [];
  const keywords = db.prepare('SELECT * FROM keywords WHERE enabled = 1').all();
  const matches = [];
  const lower = text.toLowerCase();
  for (const k of keywords) {
    const pattern = k.pattern.toLowerCase();
    if (lower.includes(pattern)) matches.push(k);
  }
  return matches;
}

export function addKeyword(db, pattern, channelId = null, roleId = null) {
  db.prepare('INSERT INTO keywords (pattern, channel_id, role_id) VALUES (?, ?, ?)')
    .run(pattern, channelId, roleId);
}

export function removeKeyword(db, id) {
  db.prepare('DELETE FROM keywords WHERE id = ?').run(id);
}

export function listKeywords(db) {
  return db.prepare('SELECT * FROM keywords ORDER BY id ASC').all();
}

export function recordPosted(db, callId, messageId, channelId) {
  db.prepare(`
    INSERT INTO posted_messages (call_id, message_id, channel_id)
    VALUES (?, ?, ?)
    ON CONFLICT(call_id) DO UPDATE SET
      message_id = excluded.message_id,
      channel_id = excluded.channel_id,
      posted_at = strftime('%s', 'now')
  `).run(callId, messageId, channelId);
}

export function getStats(db) {
  const total = db.prepare('SELECT COUNT(*) as n FROM calls').get().n;
  const transcribed = db.prepare('SELECT COUNT(*) as n FROM transcripts').get().n;
  const posted = db.prepare('SELECT COUNT(*) as n FROM posted_messages').get().n;
  const last24h = db.prepare(`SELECT COUNT(*) as n FROM calls WHERE created_at > strftime('%s', 'now') - 86400`).get().n;
  return { total, transcribed, posted, last24h };
}

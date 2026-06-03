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
  // ─── Schema migration: ensure start_time_ms column + better UNIQUE ─────────
  // Check if `calls` table exists and whether it has the new columns.
  const hasCallsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calls'").get();
  if (!hasCallsTable) {
    db.exec(`
      CREATE TABLE calls (
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
        start_time_ms INTEGER,
        stop_time INTEGER,
        audio_path TEXT,
        audio_size INTEGER,
        audio_format TEXT,
        sidecar_json TEXT,
        recorded_at TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(short_name, call_num, start_time, start_time_ms)
      );
    `);
  } else {
    // Migration: add start_time_ms if missing, then ensure constraint.
    const cols = db.prepare("PRAGMA table_info(calls)").all();
    const hasMs = cols.some(c => c.name === 'start_time_ms');
    if (!hasMs) {
      db.exec("ALTER TABLE calls ADD COLUMN start_time_ms INTEGER");
      // Backfill from start_time * 1000 where start_time_ms is null
      db.exec("UPDATE calls SET start_time_ms = start_time * 1000 WHERE start_time_ms IS NULL AND start_time IS NOT NULL");
    }
    // Check whether the UNIQUE constraint includes start_time_ms. SQLite
    // doesn't expose constraint names in a portable way, so we use the
    // index list. The index `sqlite_autoindex_calls_N` is the UNIQUE
    // constraint; check if any of its columns include start_time_ms.
    const indexes = db.prepare("PRAGMA index_list(calls)").all();
    let needsRecreate = true;
    for (const idx of indexes) {
      if (!idx.unique) continue;
      const idxCols = db.prepare(`PRAGMA index_info("${idx.name}")`).all().map(c => c.name);
      if (idxCols.includes('start_time_ms')) { needsRecreate = false; break; }
    }
    if (needsRecreate) {
      // Recreate the table with the new constraint. The old UNIQUE was
      // (short_name, call_num, start_time); we want to add start_time_ms.
      db.exec(`
        BEGIN;
        CREATE TABLE calls_new (
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
          start_time_ms INTEGER,
          stop_time INTEGER,
          audio_path TEXT,
          audio_size INTEGER,
          audio_format TEXT,
          sidecar_json TEXT,
          recorded_at TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          UNIQUE(short_name, call_num, start_time, start_time_ms)
        );
        INSERT INTO calls_new SELECT
          id, short_name, call_num, freq, talkgroup, talkgroup_tag,
          talkgroup_description, talkgroup_group, call_length,
          start_time, start_time_ms, stop_time, audio_path, audio_size, audio_format,
          sidecar_json, recorded_at, created_at
        FROM calls;
        DROP TABLE calls;
        ALTER TABLE calls_new RENAME TO calls;
        COMMIT;
      `);
    }
  }
  // Indexes (idempotent)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_calls_recorded ON calls(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_calls_talkgroup ON calls(talkgroup);
    CREATE INDEX IF NOT EXISTS idx_calls_tg_time ON calls(talkgroup, start_time_ms);

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
      call_id INTEGER NOT NULL,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      posted_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(call_id, channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_posted_call ON posted_messages(call_id);

    CREATE TABLE IF NOT EXISTS bot_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS tone_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      talkgroup_id INTEGER,
      description TEXT,
      tone_a_hz REAL NOT NULL,
      tone_b_hz REAL NOT NULL,
      tone_a_ms INTEGER DEFAULT 1000,
      tone_b_ms INTEGER DEFAULT 3000,
      department TEXT,
      notes TEXT,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tone_list_tg ON tone_list(talkgroup_id);
    CREATE INDEX IF NOT EXISTS idx_tone_list_pair ON tone_list(tone_a_hz, tone_b_hz);

    CREATE TABLE IF NOT EXISTS tone_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
      tone_a_hz REAL,
      tone_b_hz REAL,
      department_id INTEGER REFERENCES tone_list(id),
      confidence REAL,
      status TEXT DEFAULT 'detected',
      notes TEXT,
      detected_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tone_records_call ON tone_records(call_id);
  `);
  return db;
}

// ─── Tone list CRUD ───────────────────────────────────────────────────────────

export function addToneListEntry(db, entry) {
  const info = db.prepare(`
    INSERT INTO tone_list (talkgroup_id, description, tone_a_hz, tone_b_hz, tone_a_ms, tone_b_ms, department, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(entry.talkgroup_id || null, entry.description || null, entry.tone_a_hz, entry.tone_b_hz,
        entry.tone_a_ms || 1000, entry.tone_b_ms || 3000, entry.department || null, entry.notes || null);
  return info.lastInsertRowid;
}

export function removeToneListEntry(db, id) {
  db.prepare('DELETE FROM tone_list WHERE id = ?').run(id);
}

export function listToneList(db) {
  return db.prepare('SELECT * FROM tone_list ORDER BY talkgroup_id, tone_a_hz').all();
}

export function importToneListCsv(db, csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return { added: 0, errors: ['CSV has no data rows'] };
  // Skip header. Expected columns:
  // talkgroup_id,description,tone_a_hz,tone_b_hz,tone_a_ms,tone_b_ms,department,notes
  const header = lines[0].split(',').map(s => s.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  let added = 0;
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(s => s.trim());
    if (cells.length < 4) { errors.push(`Row ${i + 1}: too few columns`); continue; }
    const tg = idx('talkgroup_id') >= 0 ? cells[idx('talkgroup_id')] : '';
    const desc = idx('description') >= 0 ? cells[idx('description')] : '';
    const a = Number(cells[idx('tone_a_hz')]);
    const b = Number(cells[idx('tone_b_hz')]);
    if (!a || !b) { errors.push(`Row ${i + 1}: bad frequencies`); continue; }
    addToneListEntry(db, {
      talkgroup_id: tg ? Number(tg) : null,
      description: desc || null,
      tone_a_hz: a,
      tone_b_hz: b,
      tone_a_ms: idx('tone_a_ms') >= 0 ? Number(cells[idx('tone_a_ms')]) || 1000 : 1000,
      tone_b_ms: idx('tone_b_ms') >= 0 ? Number(cells[idx('tone_b_ms')]) || 3000 : 3000,
      department: idx('department') >= 0 ? cells[idx('department')] : null,
      notes: idx('notes') >= 0 ? cells[idx('notes')] : null,
    });
    added++;
  }
  return { added, errors };
}

export function getToneListForCall(db, call) {
  if (!call) return [];
  // Return all enabled tone-list entries for the call's talkgroup
  // (plus a global list with null talkgroup_id, if any).
  return db.prepare(`
    SELECT * FROM tone_list
    WHERE enabled = 1 AND (talkgroup_id = ? OR talkgroup_id IS NULL)
    ORDER BY talkgroup_id NULLS LAST, tone_a_hz
  `).all(call.talkgroup);
}

export function getTonesForCall(db, callId) {
  return db.prepare(`
    SELECT tr.*, tl.department, tl.description
    FROM tone_records tr
    LEFT JOIN tone_list tl ON tl.id = tr.department_id
    WHERE tr.call_id = ? AND tr.status = 'detected'
  `).all(callId);
}

// ─── Ingest helpers (shared between local watcher and HTTP push) ───────────────

// Ingest a parsed call object (from sidecar + optional audio info). If the
// call already exists, the audio_path/audio_size/audio_format get refreshed
// (in case the file appeared after the sidecar).
export function ingestCall(db, call) {
  return upsertCall(db, call);
}

export function upsertCall(db, call) {
  // Derive start_time_ms from start_time * 1000 if not present in the sidecar
  const startTimeMs = call.start_time_ms ?? (call.start_time ? call.start_time * 1000 : null);
  const stmt = db.prepare(`
    INSERT INTO calls (
      short_name, call_num, freq, talkgroup, talkgroup_tag,
      talkgroup_description, talkgroup_group, call_length,
      start_time, start_time_ms, stop_time, audio_path, audio_size, audio_format,
      sidecar_json, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(short_name, call_num, start_time, start_time_ms) DO UPDATE SET
      audio_path = COALESCE(excluded.audio_path, calls.audio_path),
      audio_size = COALESCE(excluded.audio_size, calls.audio_size),
      audio_format = COALESCE(excluded.audio_format, calls.audio_format),
      sidecar_json = excluded.sidecar_json
  `);
  const info = stmt.run(
    call.short_name, call.call_num, call.freq, call.talkgroup, call.talkgroup_tag,
    call.talkgroup_description, call.talkgroup_group, call.call_length,
    call.start_time, startTimeMs, call.stop_time, call.audio_path, call.audio_size, call.audio_format,
    call.sidecar_json, call.recorded_at
  );
  if (info.changes > 0 && info.lastInsertRowid) return info.lastInsertRowid;
  // Update path: find the existing row by all 4 UNIQUE cols
  const existing = db.prepare(`
    SELECT id FROM calls
    WHERE short_name = ? AND call_num = ?
      AND (start_time = ? OR (start_time IS NULL AND ? IS NULL))
      AND (start_time_ms = ? OR (start_time_ms IS NULL AND ? IS NULL))
  `).get(call.short_name, call.call_num,
         call.start_time, call.start_time,
         startTimeMs, startTimeMs);
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
    ON CONFLICT(call_id, channel_id) DO UPDATE SET
      message_id = excluded.message_id,
      channel_id = excluded.channel_id,
      posted_at = strftime('%s', 'now')
  `).run(callId, messageId, channelId);
}

// ─── Bot state (for persisted lastSeenId etc.) ───────────────────────────

export function getBotState(db, key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key);
  if (!row) return defaultValue;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setBotState(db, key, value) {
  db.prepare(`
    INSERT INTO bot_state (key, value, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = strftime('%s', 'now')
  `).run(key, JSON.stringify(value));
}

// Has a call been posted to a particular channel already?
export function wasPostedTo(db, callId, channelId) {
  return !!db.prepare('SELECT 1 FROM posted_messages WHERE call_id = ? AND channel_id = ?').get(callId, channelId);
}

// Find calls that have audio_path=NULL but should be re-checked.
// (In case the audio file appeared after the sidecar was first ingested.)
export function getCallsMissingAudio(db, limit = 50) {
  return db.prepare(`
    SELECT * FROM calls
    WHERE audio_path IS NULL
    ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

export function getStats(db) {
  const total = db.prepare('SELECT COUNT(*) as n FROM calls').get().n;
  const transcribed = db.prepare('SELECT COUNT(*) as n FROM transcripts').get().n;
  const posted = db.prepare('SELECT COUNT(*) as n FROM posted_messages').get().n;
  const last24h = db.prepare(`SELECT COUNT(*) as n FROM calls WHERE created_at > strftime('%s', 'now') - 86400`).get().n;
  const toneCount = db.prepare(`SELECT COUNT(*) as n FROM tone_records WHERE status = 'detected'`).get().n;
  return { total, transcribed, posted, last24h, tones: toneCount };
}

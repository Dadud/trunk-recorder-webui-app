// Tone detector role: poll store for unanalyzed calls, run icad-detect,
// write back tone records. Runs alongside transcriber, separate concern.
import { getDb } from '../lib/db.js';
import { detectTones } from '../lib/icad.js';

// Upsert a tone_records row. The call_id is UNIQUE, so a retry that finds
// a call with an existing row (e.g. previously marked 'no_list' or 'error')
// updates the row in place rather than crashing on the UNIQUE constraint.
function upsertToneRecord(db, callId, fields) {
  db.prepare(`
    INSERT INTO tone_records (call_id, tone_a_hz, tone_b_hz, department_id, confidence, status, notes, detected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    ON CONFLICT(call_id) DO UPDATE SET
      tone_a_hz = excluded.tone_a_hz,
      tone_b_hz = excluded.tone_b_hz,
      department_id = excluded.department_id,
      confidence = excluded.confidence,
      status = excluded.status,
      notes = excluded.notes,
      detected_at = strftime('%s', 'now')
  `).run(
    callId,
    fields.tone_a_hz ?? null,
    fields.tone_b_hz ?? null,
    fields.department_id ?? null,
    fields.confidence ?? null,
    fields.status ?? 'detected',
    fields.notes ?? null
  );
}

export function startToneDetector({ dbPath, intervalMs = 5000, log = console }) {
  const db = getDb(dbPath);
  log.info('[tone-detector] starting');

  let busy = false;
  let processed = 0;
  let matched = 0;
  let binaryMissing = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      // Find calls that have audio and either have no tone_records row, or
      // have a previous error/no_tone/no_list row that's older than the
      // retry cooldown. Successfully-detected rows are excluded.
      const pending = db.prepare(`
        SELECT c.* FROM calls c
        LEFT JOIN tone_records tr ON tr.call_id = c.id
        LEFT JOIN transcripts t ON t.call_id = c.id
        WHERE c.audio_path IS NOT NULL
          AND (t.id IS NOT NULL OR c.created_at < strftime('%s', 'now') - 60)
          AND (
            tr.id IS NULL
            OR (tr.status IN ('error', 'no_tone', 'no_list')
                AND tr.detected_at < strftime('%s', 'now') - 300)
          )
          AND NOT EXISTS (
            SELECT 1 FROM tone_records tr2
            WHERE tr2.call_id = c.id AND tr2.status = 'detected'
          )
        ORDER BY c.recorded_at ASC LIMIT 1
      `).all();
      if (pending.length === 0) return;
      const call = pending[0];

      // Load tone list
      const tones = db.prepare('SELECT * FROM tone_list').all();
      if (tones.length === 0) {
        // No tone list configured; mark the call as "checked, no list" so we
        // don't loop on it. Operator can seed a tone list later.
        upsertToneRecord(db, call.id, { status: 'no_list', notes: 'No tone list configured' });
        return;
      }

      const t0 = Date.now();
      const result = await detectTones(call.audio_path, tones);
      const dt = Date.now() - t0;
      if (!result.ok) {
        if (result.error?.includes('not found')) {
          if (!binaryMissing) {
            log.warn('[tone-detector] icad-detect binary not installed, role will idle');
            binaryMissing = true;
          }
          // Don't mark — operator might install the binary later
          return;
        }
        log.warn(`[tone-detector] call ${call.id} error: ${result.error}`);
        upsertToneRecord(db, call.id, { status: 'error', notes: result.error?.slice(0, 200) });
        return;
      }

      const detected = result.tones || [];
      if (detected.length === 0) {
        upsertToneRecord(db, call.id, { status: 'no_tone' });
        processed++;
        return;
      }

      // Write one tone_record per detected tone (typically 0 or 1)
      for (const t of detected) {
        upsertToneRecord(db, call.id, {
          tone_a_hz: t.tone_a_hz,
          tone_b_hz: t.tone_b_hz,
          department_id: t.department_id || null,
          confidence: t.confidence || null,
          status: 'detected',
        });
        matched++;
      }
      processed++;
      const depts = detected.map(t => t.department || `${t.tone_a_hz}Hz→${t.tone_b_hz}Hz`).join(', ');
      log.info(`[tone-detector] call ${call.id}: ${detected.length} tone(s) in ${dt}ms — ${depts}`);
    } catch (err) {
      log.warn(`[tone-detector] tick error: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  const handle = setInterval(tick, intervalMs);
  tick();
  return {
    stop: () => clearInterval(handle),
    get processed() { return processed; },
    get matched() { return matched; },
  };
}

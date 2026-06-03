// Tone detector role: poll store for unanalyzed calls, run icad-detect,
// write back tone records. Runs alongside transcriber, separate concern.
import { getDb } from '../lib/db.js';
import { detectTones } from '../lib/icad.js';

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
      // Find calls that have audio, no tone records yet, transcribed OR
      // older than 60s (in case no transcript ever lands).
      const pending = db.prepare(`
        SELECT c.* FROM calls c
        LEFT JOIN tone_records tr ON tr.call_id = c.id
        WHERE tr.id IS NULL
          AND c.audio_path IS NOT NULL
          AND (c.transcript_id IS NOT NULL OR c.created_at < strftime('%s', 'now') - 60)
        ORDER BY c.recorded_at ASC LIMIT 1
      `).all();
      if (pending.length === 0) return;
      const call = pending[0];

      // Load tone list
      const tones = db.prepare('SELECT * FROM tone_list').all();
      if (tones.length === 0) {
        // No tone list configured; mark the call as "checked, no list" so we
        // don't loop on it. Operator can seed a tone list later.
        db.prepare('INSERT INTO tone_records (call_id, status, notes) VALUES (?, ?, ?)')
          .run(call.id, 'no_list', 'No tone list configured');
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
        db.prepare('INSERT INTO tone_records (call_id, status, notes) VALUES (?, ?, ?)')
          .run(call.id, 'error', result.error?.slice(0, 200));
        return;
      }

      const detected = result.tones || [];
      if (detected.length === 0) {
        db.prepare('INSERT INTO tone_records (call_id, status) VALUES (?, ?)')
          .run(call.id, 'no_tone');
        processed++;
        return;
      }

      // Write one tone_record per detected tone (typically 0 or 1)
      const ins = db.prepare(`
        INSERT INTO tone_records (call_id, tone_a_hz, tone_b_hz, department_id, confidence)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const t of detected) {
        ins.run(call.id, t.tone_a_hz, t.tone_b_hz, t.department_id || null, t.confidence || null);
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

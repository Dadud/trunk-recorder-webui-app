// Transcriber role: poll store for untranscribed calls, POST to Qwen3, write back.
//
// Circuit-breaker design: when Qwen3 is unreachable (network error or 5xx),
// the breaker opens after CIRCUIT_FAIL_THRESHOLD consecutive failures and
// pauses all attempts for CIRCUIT_RESET_MS. This stops the role from
// hammering a dead Qwen3 every 2s. When the breaker resets, we try again.
// Crucially, we do NOT mark calls as failed when the breaker is open —
// the failure is transient and we want to retry when the service is back.
import { getDb, setTranscript } from '../lib/db.js';
import fs from 'fs';
import path from 'path';

function stripPrefix(text) {
  if (!text) return '';
  const m = text.match(/^language\s+\S+<asr_text>(.*)$/s);
  if (m) return m[1].trim();
  return text;
}

const CIRCUIT_FAIL_THRESHOLD = 2;
const CIRCUIT_RESET_MS = 60_000;

async function transcribeOne(call, qwenUrl) {
  if (!call.audio_path || !fs.existsSync(call.audio_path)) {
    return { skipped: true, reason: 'no audio file' };
  }
  const stat = fs.statSync(call.audio_path);
  if (stat.size < 1000) {
    return { skipped: true, reason: 'audio too small' };
  }

  const fileBuffer = fs.readFileSync(call.audio_path);
  const blob = new Blob([fileBuffer], { type: 'audio/wav' });
  const form = new FormData();
  form.append('file', blob, path.basename(call.audio_path));
  form.append('response_format', 'json');

  const url = `${qwenUrl.replace(/\/$/, '')}/v1/audio/transcriptions`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: form });
  } catch (networkErr) {
    const err = new Error(`Qwen network error: ${networkErr.message}`);
    err.transient = true;
    err.status = 0;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status >= 400 && res.status < 500) {
      return { skipped: true, reason: `qwen ${res.status}: ${text.slice(0, 100)}` };
    }
    const err = new Error(`Qwen HTTP ${res.status}: ${text.slice(0, 200)}`);
    err.transient = true;
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return { text: stripPrefix(data.text || ''), language: data.language || null, duration: data.duration || call.call_length };
}

export function startTranscriber({ dbPath, qwenUrl, intervalMs = 2000, log = console }) {
  const db = getDb(dbPath);
  log.info(`[transcriber] starting, qwen=${qwenUrl}`);

  let busy = false;
  let processed = 0;
  let circuitState = 'closed';
  let circuitOpenedAt = 0;
  let consecutiveErrors = 0;

  function circuitIsOpen() {
    if (circuitState === 'closed') return false;
    if (Date.now() - circuitOpenedAt > CIRCUIT_RESET_MS) {
      log.info('[transcriber] circuit breaker reset; will retry Qwen3');
      circuitState = 'closed';
      consecutiveErrors = 0;
      return false;
    }
    return true;
  }

  async function tick() {
    if (busy) return;
    if (circuitIsOpen()) return;
    busy = true;
    try {
      const pending = db.prepare(`
        SELECT c.* FROM calls c
        LEFT JOIN transcripts t ON t.call_id = c.id
        WHERE t.id IS NULL AND c.audio_path IS NOT NULL
        ORDER BY c.recorded_at ASC LIMIT 1
      `).all();
      const call = pending[0];
      if (!call) return;
      const t0 = Date.now();
      const result = await transcribeOne(call, qwenUrl);
      if (result.skipped) {
        // 4xx: this specific call is bad. Mark as skipped so we don't loop.
        setTranscript(db, call.id, { text: '', language: null, duration: call.call_length, model: 'skipped' });
        consecutiveErrors = 0;
        return;
      }
      setTranscript(db, call.id, { ...result, model: 'qwen3-asr' });
      processed++;
      consecutiveErrors = 0;
      const dt = Date.now() - t0;
      log.info(`[transcriber] call ${call.id} (${call.talkgroup_tag || 'unknown'}) transcribed in ${dt}ms — "${(result.text || '').slice(0, 60)}"`);
    } catch (err) {
      consecutiveErrors++;
      log.warn(`[transcriber] transient error: ${err.message} (consecutive=${consecutiveErrors})`);
      if (err.transient && consecutiveErrors >= CIRCUIT_FAIL_THRESHOLD) {
        circuitState = 'open';
        circuitOpenedAt = Date.now();
        log.warn(`[transcriber] circuit breaker OPEN; pausing for ${CIRCUIT_RESET_MS}ms`);
        // Do NOT mark the call as failed. We want to retry it when Qwen3 is back.
      }
    } finally {
      busy = false;
    }
  }

  const handle = setInterval(tick, intervalMs);
  tick();
  return { stop: () => clearInterval(handle), get processed() { return processed; } };
}

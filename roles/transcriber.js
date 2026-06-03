// Transcriber role: poll store for untranscribed calls, POST to Qwen3, write back
import { getDb, getUntranscribed, setTranscript } from '../lib/db.js';
import fs from 'fs';

async function transcribeOne(call, qwenUrl) {
  if (!call.audio_path || !fs.existsSync(call.audio_path)) {
    return { skipped: true, reason: 'no audio file' };
  }
  const stat = fs.statSync(call.audio_path);
  if (stat.size < 1000) {
    return { skipped: true, reason: 'audio too small' };
  }

  // Build multipart/form-data POST manually (Node 22 has FormData + File built in)
  const fileBuffer = fs.readFileSync(call.audio_path);
  const blob = new Blob([fileBuffer], { type: 'audio/wav' });
  const form = new FormData();
  form.append('file', blob, path.basename(call.audio_path));
  form.append('response_format', 'json');

  const url = `${qwenUrl.replace(/\/$/, '')}/v1/audio/transcriptions`;
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    // Treat 4xx errors as permanent failures (the call itself is bad) and skip
    // them. 5xx is a transient server problem, mark for retry by throwing.
    if (res.status >= 400 && res.status < 500) {
      return { skipped: true, reason: `qwen ${res.status}: ${text.slice(0, 100)}` };
    }
    throw new Error(`Qwen HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return { text: stripPrefix(data.text || ''), language: data.language || null, duration: data.duration || call.call_length };
}

import path from 'path';
function stripPrefix(text) {
  if (!text) return '';
  // Qwen3 emits "language LANG<asr_text>TRANSCRIPT" — strip the language prefix
  const m = text.match(/^language\s+\S+<asr_text>(.*)$/s);
  if (m) return m[1].trim();
  return text;
}

export function startTranscriber({ dbPath, qwenUrl, intervalMs = 2000, log = console }) {
  const db = getDb(dbPath);
  log.info(`[transcriber] starting, qwen=${qwenUrl}`);

  let busy = false;
  let processed = 0;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const pending = getUntranscribed(db, 1);
      if (pending.length === 0) return;
      const call = pending[0];
      const t0 = Date.now();
      const result = await transcribeOne(call, qwenUrl);
      if (result.skipped) {
        // Mark as transcribed with empty text so we don't loop on it
        setTranscript(db, call.id, { text: '', language: null, duration: call.call_length, model: 'skipped' });
        return;
      }
      setTranscript(db, call.id, { ...result, model: 'qwen3-asr' });
      processed++;
      const dt = Date.now() - t0;
      log.info(`[transcriber] call ${call.id} (${call.talkgroup_tag}) transcribed in ${dt}ms — "${result.text.slice(0, 60)}..."`);
    } catch (err) {
      log.warn(`[transcriber] error: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  const handle = setInterval(tick, intervalMs);
  // Run once immediately
  tick();
  return { stop: () => clearInterval(handle), get processed() { return processed; } };
}

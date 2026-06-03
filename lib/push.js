// Client-side helper: push a call (sidecar JSON + audio file) from a remote
// recorder box to the gateway's /api/calls endpoint via multipart/form-data.
//
// Used by the watcher role on SDRBOX (where the recordings live) to deliver
// new calls to the gateway (where the store, transcriber, and bot all run).
//
// On dev hosts where the watcher is local, the push is a no-op and chokidar
// writes straight to the local SQLite.

import fs from 'fs';
import path from 'path';
import { buildCallFromJson } from './sidecar.js';

const BATCH_DEBOUNCE_MS = 200; // collapse rapid-fire sidecar+audio pairs

export async function pushCallToGateway(gatewayUrl, jsonPath) {
  const url = `${gatewayUrl.replace(/\/$/, '')}/api/calls`;
  const call = buildCallFromJson(jsonPath);

  const form = new FormData();
  form.append('sidecar', JSON.stringify(call));
  if (call.audio_path && fs.existsSync(call.audio_path)) {
    const buf = await fs.promises.readFile(call.audio_path);
    form.append('audio', new Blob([buf], { type: 'audio/wav' }), path.basename(call.audio_path));
  }
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// Local-mode passthrough: writes the call directly to the local SQLite store.
// Same end result as pushCallToGateway, just no network hop.
export function ingestLocally(db, jsonPath) {
  const call = buildCallFromJson(jsonPath);
  return db.prepare(`
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
  `).run(
    call.short_name, call.call_num, call.freq, call.talkgroup, call.talkgroup_tag,
    call.talkgroup_description, call.talkgroup_group, call.call_length,
    call.start_time, call.stop_time, call.audio_path, call.audio_size, call.audio_format,
    call.sidecar_json, call.recorded_at
  );
}

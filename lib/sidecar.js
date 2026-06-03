// Parse trunk-recorder sidecar JSON and audio file pairing
import path from 'path';
import fs from 'fs';

export function parseSidecar(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  return {
    short_name: data.short_name || 'unknown',
    call_num: data.call_num,
    freq: data.freq,
    talkgroup: data.talkgroup,
    talkgroup_tag: data.talkgroup_tag || null,
    talkgroup_description: data.talkgroup_description || null,
    talkgroup_group: data.talkgroup_group || null,
    call_length: data.call_length,
    start_time: data.start_time,
    stop_time: data.stop_time,
    start_time_ms: data.start_time_ms,
    sidecar_json: JSON.stringify(data),
    recorded_at: new Date((data.start_time_ms || data.start_time * 1000)).toISOString(),
  };
}

// Find the audio file that pairs with a given sidecar JSON.
// Trunk-recorder writes either .wav or .m4a alongside the .json with the same basename.
export function findAudioFile(jsonPath) {
  const dir = path.dirname(jsonPath);
  const base = path.basename(jsonPath, '.json');
  for (const ext of ['.wav', '.m4a', '.mp3']) {
    const p = path.join(dir, base + ext);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      return { path: p, size: stat.size, format: ext.slice(1) };
    }
  }
  return null;
}

// Build a call record from a JSON path
export function buildCallFromJson(jsonPath) {
  const call = parseSidecar(jsonPath);
  const audio = findAudioFile(jsonPath);
  if (audio) {
    call.audio_path = audio.path;
    call.audio_size = audio.size;
    call.audio_format = audio.format;
  }
  return call;
}

// Recorder-side watcher: chokidar on recordings dir, deliver each new call
// to either the local SQLite store OR a remote gateway via HTTP push.
//
// Two modes, selected by config:
//   - local: writes directly to the local SQLite db (default for dev /
//     when watcher and store run on the same box)
//   - push:  POSTs the call to a remote gateway URL via /api/calls
//     (used when watcher runs on the SDR box, store runs on the gateway)
import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { buildCallFromJson } from '../lib/sidecar.js';
import { pushCallToGateway, ingestLocally } from '../lib/push.js';
import { getDb } from '../lib/db.js';

export function startWatcher({ recordingsDir, dbPath, pushTo, log = console }) {
  log.info(`[watcher] starting on ${recordingsDir} (mode: ${pushTo ? `push to ${pushTo}` : 'local SQLite'})`);
  const db = pushTo ? null : getDb(dbPath);

  // Chokidar gotcha: a globbed watch path (recordingsDir/**/*.json) doesn't
  // discover new subdirectories created AFTER the watcher starts unless those
  // parents already exist. We watch the directory itself with depth: 99 and
  // filter for .json ourselves in the 'add' handler.
  const watcher = chokidar.watch(recordingsDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    persistent: true,
    depth: 99,
  });

  let count = 0;
  let errors = 0;

  watcher.on('add', async (jsonPath) => {
    if (!jsonPath.endsWith('.json')) return; // only sidecar JSONs; ignore wavs
    try {
      // Wait for the audio file to actually land. The sidecar JSON is written
      // first, then the encoder closes the wav ~200-3000ms later (variable
      // based on disk pressure and call length). Poll for the wav to exist
      // AND have a non-trivial size, with a 6s budget. If we time out, send
      // the call anyway — the gateway will get audio_path=null and the
      // transcriber/bot will skip it cleanly.
      const dir = path.dirname(jsonPath);
      const base = path.basename(jsonPath, '.json');
      const wavPath = path.join(dir, base + '.wav');
      const startWait = Date.now();
      let wavSize = 0;
      while (Date.now() - startWait < 6000) {
        try {
          const stat = fs.statSync(wavPath);
          if (stat.size > 1000) { wavSize = stat.size; break; }
        } catch { /* not yet */ }
        await sleep(150);
      }
      if (wavSize === 0) log.warn(`[watcher] no wav for ${base} after 6s, sending audio_path=null`);
      const call = buildCallFromJson(jsonPath);

      if (pushTo) {
        const result = await pushCallToGateway(pushTo, jsonPath);
        count++;
        if (count % 50 === 0) log.info(`[watcher] pushed ${count} calls (last: ${call.talkgroup_tag} @ ${(call.freq/1e6).toFixed(3)}MHz, audio=${call.audio_path ? 'yes' : 'no'})`);
      } else {
        const info = ingestLocally(db, jsonPath);
        count++;
        if (count % 50 === 0) log.info(`[watcher] ingested ${count} calls (last: ${call.talkgroup_tag} @ ${(call.freq/1e6).toFixed(3)}MHz)`);
      }
    } catch (err) {
      errors++;
      log.warn(`[watcher] failed to process ${jsonPath}: ${err.message}`);
    }
  });

  watcher.on('error', (err) => log.error(`[watcher] error: ${err.message}`));
  watcher.on('ready', () => log.info(`[watcher] ready, watching for new recordings`));

  return {
    watcher,
    stop: () => watcher.close(),
    get count() { return count; },
    get errors() { return errors; },
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

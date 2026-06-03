// Recorder-side watcher: chokidar on recordings dir, ingest calls into the store
import chokidar from 'chokidar';
import path from 'path';
import { buildCallFromJson } from '../lib/sidecar.js';
import { getDb, upsertCall } from '../lib/db.js';

export function startWatcher({ recordingsDir, dbPath, log = console }) {
  const db = getDb(dbPath);
  log.info(`[watcher] starting on ${recordingsDir}`);

  const watcher = chokidar.watch(path.join(recordingsDir, '**/*.json'), {
    // ignoreInitial: true — only ingest new files added after the watcher starts.
    // This avoids backfilling 379 historical calls on every bot restart. Set to
    // false if you want full re-ingestion (e.g. after wiping the SQLite db).
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    persistent: true,
  });

  let count = 0;
  watcher.on('add', (jsonPath) => {
    try {
      const call = buildCallFromJson(jsonPath);
      const id = upsertCall(db, call);
      count++;
      if (count % 50 === 0) log.info(`[watcher] ingested ${count} calls (last: tg ${call.talkgroup_tag} @ ${call.freq}Hz)`);
    } catch (err) {
      log.warn(`[watcher] failed to ingest ${jsonPath}: ${err.message}`);
    }
  });

  watcher.on('error', (err) => log.error(`[watcher] error: ${err.message}`));
  watcher.on('ready', () => log.info(`[watcher] ready, watching for new recordings`));

  return { watcher, stop: () => watcher.close() };
}

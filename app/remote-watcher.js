// SDRBOX-side entrypoint. Runs ONLY the watcher role in push mode.
// No webui, no Discord, no Qwen3, no SQLite — just chokidar → HTTP POST.
//
// Config via .env (loaded by dotenv) or shell env:
//   GATEWAY_URL  e.g. http://192.168.1.61:8080
//   RECORDINGS_DIR e.g. /home/dadud/recordings/pittsville
//
// This file is intentionally minimal: it boots, tails the recordings dir,
// and pushes each new call to the gateway. Anything more (transcriber,
// bot, webui) lives on the gateway, not here.
import 'dotenv/config';
import { startWatcher } from '../roles/watcher.js';

const gatewayUrl = process.env.GATEWAY_URL;
const recordingsDir = process.env.RECORDINGS_DIR;

if (!gatewayUrl) { console.error('GATEWAY_URL is required'); process.exit(1); }
if (!recordingsDir) { console.error('RECORDINGS_DIR is required'); process.exit(1); }

console.log(`[remote-watcher] gateway=${gatewayUrl} dir=${recordingsDir}`);

const { stop, count, errors } = startWatcher({
  recordingsDir,
  pushTo: gatewayUrl,
  log: { info: m => console.log(m), warn: m => console.warn(m), error: m => console.error(m) },
});

// Periodic status log
setInterval(() => {
  console.log(`[remote-watcher] stats: pushed=${count} errors=${errors}`);
}, 60_000);

const shutdown = (sig) => {
  console.log(`[remote-watcher] ${sig} received, stopping`);
  stop();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

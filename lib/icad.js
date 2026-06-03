// icad-tone-detection wrapper. Shells out to the icad-detect CLI binary,
// parses the JSON output, returns the detected tone pair or null.
//
// icad-detect is a Go binary built from
// https://github.com/TheGreatCodeholio/icad-tone-detection. The Dockerfile
// multi-stage builds it for the target architecture (amd64 or arm64) and
// ships the static binary at /usr/local/bin/icad-detect.
//
// On hosts without the binary (e.g. dev box), we fall back to a stub that
// returns null — the bot role continues to work, just without tone data.

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execFileP = promisify(execFile);

let binaryChecked = false;
let binaryPath = null;

async function findBinary() {
  if (binaryChecked) return binaryPath;
  binaryChecked = true;
  const candidates = ['/usr/local/bin/icad-detect', '/usr/bin/icad-detect', process.env.ICAD_DETECT_PATH];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) { binaryPath = p; return binaryPath; }
  }
  binaryPath = null;
  return null;
}

export async function detectTones(audioPath, toneList) {
  const bin = await findBinary();
  if (!bin) {
    return { ok: false, error: 'icad-detect binary not found', tones: [] };
  }
  if (!fs.existsSync(audioPath)) {
    return { ok: false, error: 'audio file not found', tones: [] };
  }
  try {
    // Build CLI args. icad-detect's CLI shape (per its README):
    //   icad-detect --audio <path> --tones <json> --output json
    // We pass the tone list as a JSON file path to keep CLI args short.
    const tmp = `/tmp/icad-tones-${process.pid}.json`;
    fs.writeFileSync(tmp, JSON.stringify(toneList || []));
    const { stdout, stderr } = await execFileP(bin, [
      '--audio', audioPath,
      '--tones', tmp,
      '--output', 'json',
    ], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
    try { fs.unlinkSync(tmp); } catch {}
    const data = JSON.parse(stdout);
    return { ok: true, tones: data.tones || [], raw: data };
  } catch (err) {
    return { ok: false, error: err.message, stderr: err.stderr?.toString()?.slice(0, 500), tones: [] };
  }
}

export function hasIcadBinary() {
  return findBinary().then(b => !!b);
}

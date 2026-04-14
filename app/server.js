import express from 'express';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const configDir = path.join(root, 'config');
const configPath = path.join(configDir, 'config.json');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function ensureConfig() {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ ver: 2, sources: [], systems: [], plugins: [] }, null, 2));
  }
}

function readConfig() {
  ensureConfig();
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function writeConfig(config) {
  ensureConfig();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function shell(cmd) {
  try {
    return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (err) {
    return (err.stdout?.toString() || '') + (err.stderr?.toString() || err.message);
  }
}

function validateConfig(config) {
  const errors = [];
  if (config.ver !== 2) errors.push('ver must be 2');
  if (!Array.isArray(config.sources) || config.sources.length === 0) errors.push('at least one source is required');
  if (!Array.isArray(config.systems) || config.systems.length === 0) errors.push('at least one system is required');

  (config.sources || []).forEach((s, i) => {
    if (!s.driver) errors.push(`source ${i + 1}: driver is required`);
    if (!s.center && !['iqfile', 'sigmffile'].includes(s.driver)) errors.push(`source ${i + 1}: center is required`);
    if (!s.rate) errors.push(`source ${i + 1}: rate is required`);
    if (s.gain === undefined || s.gain === '') errors.push(`source ${i + 1}: gain is required`);
  });

  (config.systems || []).forEach((s, i) => {
    if (!s.type) errors.push(`system ${i + 1}: type is required`);
    if (!Array.isArray(s.control_channels) || s.control_channels.length === 0) errors.push(`system ${i + 1}: at least one control channel is required`);
  });

  return errors;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sourceTemplate(kind = 'rtl') {
  if (kind === 'rtl') {
    return {
      driver: 'osmosdr',
      device: 'rtl=00000001',
      center: 857000000,
      rate: 2400000,
      gain: 30,
      error: 0,
      ppm: 0,
      digitalRecorders: 2,
      analogRecorders: 0,
      enabled: true
    };
  }
  if (kind === 'airspy') {
    return {
      driver: 'osmosdr',
      device: 'airspy',
      center: 857000000,
      rate: 10000000,
      gain: 12,
      error: 0,
      ppm: 0,
      digitalRecorders: 4,
      analogRecorders: 0,
      enabled: true
    };
  }
  return {
    driver: 'usrp',
    device: '',
    center: 857000000,
    rate: 8000000,
    gain: 40,
    error: 0,
    ppm: 0,
    digitalRecorders: 4,
    analogRecorders: 0,
    enabled: true
  };
}

function systemTemplate(kind = 'p25') {
  if (kind === 'smartnet') {
    return {
      type: 'smartnet',
      control_channels: [855462500],
      talkgroupsFile: 'talkgroups.csv',
      unitTagsFile: 'unit-tags.csv',
      squelch: -50,
      modulation: 'qpsk'
    };
  }
  return {
    type: 'p25',
    control_channels: [855462500],
    talkgroupsFile: 'talkgroups.csv',
    unitTagsFile: 'unit-tags.csv',
    squelch: -50,
    modulation: 'qpsk'
  };
}

function page(title, body) {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${esc(title)}</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 0; background: #f6f7fb; color: #101828; }
        .wrap { max-width: 1180px; margin: 0 auto; padding: 20px; }
        .card { background: white; border-radius: 16px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 10px rgba(16,24,40,.06); }
        .subcard { border: 1px solid #eaecf0; border-radius: 14px; padding: 16px; margin-bottom: 14px; }
        .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
        label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
        input, select, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d0d5dd; border-radius: 10px; font: inherit; }
        textarea { min-height: 320px; font-family: ui-monospace, SFMono-Regular, monospace; }
        button, .btn { background: #111827; color: white; border: 0; border-radius: 10px; padding: 10px 14px; font: inherit; cursor: pointer; text-decoration: none; display: inline-block; }
        .btn.secondary { background: #475467; }
        .btn.light { background: #e5e7eb; color: #111827; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .pill { display: inline-block; background: #eef2ff; color: #3730a3; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
        .muted { color: #667085; }
        .nav a { margin-right: 12px; color: #111827; text-decoration: none; font-weight: 700; }
        .error { background: #fef3f2; color: #b42318; padding: 10px 12px; border-radius: 10px; margin-bottom: 8px; }
        .ok { background: #ecfdf3; color: #027a48; padding: 10px 12px; border-radius: 10px; margin-bottom: 8px; }
        pre { white-space: pre-wrap; word-break: break-word; background: #0b1020; color: #e5e7eb; padding: 14px; border-radius: 12px; overflow: auto; }
        .section-title { margin-top: 0; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card nav">
          <a href="/">Overview</a>
          <a href="/wizard">Setup Wizard</a>
          <a href="/configurator">Configurator</a>
          <a href="/advanced">Advanced JSON</a>
          <a href="/status">Status</a>
          <a href="/logs">Logs</a>
        </div>
        ${body}
      </div>
    </body>
  </html>`;
}

app.get('/', (req, res) => {
  const config = readConfig();
  const errors = validateConfig(config);
  res.send(page('Overview', `
    <div class="card">
      <h1 class="section-title">Trunk Recorder Web UI</h1>
      <p class="muted">Lightweight, easy to use, and still fully configurable.</p>
      ${errors.length ? `<div class="pill">Needs setup</div>` : `<div class="pill">Config looks valid</div>`}
    </div>
    <div class="card row">
      <div><strong>Sources</strong><br>${config.sources?.length || 0}</div>
      <div><strong>Systems</strong><br>${config.systems?.length || 0}</div>
      <div><strong>Plugins</strong><br>${config.plugins?.length || 0}</div>
      <div><strong>Capture Dir</strong><br><code>${esc(config.captureDir || './data/recordings')}</code></div>
    </div>
    <div class="card">
      <h2 class="section-title">Templates</h2>
      <p class="muted">Quick-start presets to avoid a blank screen.</p>
      <div class="actions">
        <a class="btn" href="/template/rtl-p25">RTL-SDR + P25</a>
        <a class="btn secondary" href="/template/airspy-p25">Airspy + P25</a>
        <a class="btn light" href="/template/usrp-p25">USRP + P25</a>
      </div>
    </div>
    <div class="card">
      <h2 class="section-title">Validation</h2>
      ${errors.length ? errors.map(e => `<div class="error">${esc(e)}</div>`).join('') : '<div class="ok">No obvious config problems found.</div>'}
    </div>
  `));
});

app.get('/template/:name', (req, res) => {
  const config = readConfig();
  const name = req.params.name;
  config.ver = 2;
  config.captureDir = './data/recordings';
  config.logLevel = 'info';
  config.callTimeout = 3;
  if (name === 'rtl-p25') {
    config.sources = [sourceTemplate('rtl')];
    config.systems = [systemTemplate('p25')];
  } else if (name === 'airspy-p25') {
    config.sources = [sourceTemplate('airspy')];
    config.systems = [systemTemplate('p25')];
  } else {
    config.sources = [sourceTemplate('usrp')];
    config.systems = [systemTemplate('p25')];
  }
  if (!Array.isArray(config.plugins)) config.plugins = [];
  writeConfig(config);
  res.redirect('/configurator');
});

app.get('/wizard', (req, res) => {
  const config = readConfig();
  const source = config.sources?.[0] || {};
  const system = config.systems?.[0] || {};
  res.send(page('Setup Wizard', `
    <div class="card">
      <h1 class="section-title">Setup Wizard</h1>
      <p class="muted">Fast path for first-time setup.</p>
      <form method="post" action="/wizard">
        <div class="row">
          <div><label>Capture directory</label><input name="captureDir" value="${esc(config.captureDir || './data/recordings')}" /></div>
          <div><label>Log level</label><select name="logLevel">${['trace','debug','info','warning','error','fatal'].map(v => `<option ${config.logLevel===v?'selected':''}>${v}</option>`).join('')}</select></div>
          <div><label>Template</label><select name="template"><option value="custom">Custom</option><option value="rtl-p25">RTL-SDR + P25</option><option value="airspy-p25">Airspy + P25</option><option value="usrp-p25">USRP + P25</option></select></div>
        </div>
        <div class="row">
          <div><label>Source driver</label><select name="source_driver">${['osmosdr','usrp','iqfile','sigmffile'].map(v => `<option ${source.driver===v?'selected':''}>${v}</option>`).join('')}</select></div>
          <div><label>Device</label><input name="source_device" value="${esc(source.device || '')}" placeholder="rtl=0000001" /></div>
        </div>
        <div class="row">
          <div><label>Center frequency (Hz)</label><input name="source_center" value="${esc(source.center || '')}" /></div>
          <div><label>Sample rate</label><input name="source_rate" value="${esc(source.rate || '')}" /></div>
          <div><label>Gain</label><input name="source_gain" value="${esc(source.gain || '')}" /></div>
        </div>
        <div class="row">
          <div><label>Error (Hz)</label><input name="source_error" value="${esc(source.error ?? 0)}" /></div>
          <div><label>PPM</label><input name="source_ppm" value="${esc(source.ppm ?? 0)}" /></div>
          <div><label>Digital recorders</label><input name="source_digitalRecorders" value="${esc(source.digitalRecorders || 2)}" /></div>
        </div>
        <div class="row">
          <div><label>System type</label><select name="system_type">${['p25','smartnet'].map(v => `<option ${system.type===v?'selected':''}>${v}</option>`).join('')}</select></div>
          <div><label>Control channels (comma separated Hz)</label><input name="system_control_channels" value="${esc((system.control_channels || []).join(', '))}" /></div>
          <div><label>Modulation</label><input name="system_modulation" value="${esc(system.modulation || 'qpsk')}" /></div>
        </div>
        <div class="row">
          <div><label>Talkgroups file</label><input name="system_talkgroupsFile" value="${esc(system.talkgroupsFile || 'talkgroups.csv')}" /></div>
          <div><label>Unit tags file</label><input name="system_unitTagsFile" value="${esc(system.unitTagsFile || 'unit-tags.csv')}" /></div>
          <div><label>Squelch</label><input name="system_squelch" value="${esc(system.squelch ?? -50)}" /></div>
        </div>
        <button type="submit">Save Wizard Config</button>
      </form>
    </div>
  `));
});

app.post('/wizard', (req, res) => {
  const b = req.body;
  const config = readConfig();
  config.ver = 2;
  config.captureDir = b.captureDir || './data/recordings';
  config.logLevel = b.logLevel || 'info';

  if (b.template === 'rtl-p25') {
    config.sources = [sourceTemplate('rtl')];
    config.systems = [systemTemplate('p25')];
  } else if (b.template === 'airspy-p25') {
    config.sources = [sourceTemplate('airspy')];
    config.systems = [systemTemplate('p25')];
  } else if (b.template === 'usrp-p25') {
    config.sources = [sourceTemplate('usrp')];
    config.systems = [systemTemplate('p25')];
  } else {
    config.sources = [{
      driver: b.source_driver,
      device: b.source_device || '',
      center: Number(b.source_center || 0),
      rate: Number(b.source_rate || 0),
      gain: Number(b.source_gain || 0),
      error: Number(b.source_error || 0),
      ppm: Number(b.source_ppm || 0),
      digitalRecorders: Number(b.source_digitalRecorders || 2),
      analogRecorders: 0,
      enabled: true
    }];
    config.systems = [{
      type: b.system_type,
      control_channels: String(b.system_control_channels || '').split(',').map(v => v.trim()).filter(Boolean).map(v => Number(v)),
      modulation: b.system_modulation || 'qpsk',
      talkgroupsFile: b.system_talkgroupsFile || 'talkgroups.csv',
      unitTagsFile: b.system_unitTagsFile || 'unit-tags.csv',
      squelch: Number(b.system_squelch || -50)
    }];
  }

  if (!Array.isArray(config.plugins)) config.plugins = [];
  writeConfig(config);
  res.redirect('/configurator');
});

app.get('/configurator', (req, res) => {
  const config = readConfig();
  const sources = config.sources?.length ? config.sources : [sourceTemplate('rtl')];
  const systems = config.systems?.length ? config.systems : [systemTemplate('p25')];

  res.send(page('Configurator', `
    <div class="card">
      <h1 class="section-title">Configurator</h1>
      <p class="muted">Edit sources and systems with forms, not just raw JSON.</p>
      <div class="actions">
        <a class="btn light" href="/configurator/add-source/rtl">Add RTL source</a>
        <a class="btn light" href="/configurator/add-source/airspy">Add Airspy source</a>
        <a class="btn light" href="/configurator/add-source/usrp">Add USRP source</a>
        <a class="btn light" href="/configurator/add-system/p25">Add P25 system</a>
        <a class="btn light" href="/configurator/add-system/smartnet">Add SmartNet system</a>
      </div>
    </div>
    <div class="card">
      <form method="post" action="/configurator">
        <div class="row">
          <div><label>Capture directory</label><input name="captureDir" value="${esc(config.captureDir || './data/recordings')}" /></div>
          <div><label>Log level</label><select name="logLevel">${['trace','debug','info','warning','error','fatal'].map(v => `<option ${config.logLevel===v?'selected':''}>${v}</option>`).join('')}</select></div>
          <div><label>Call timeout</label><input name="callTimeout" value="${esc(config.callTimeout ?? 3)}" /></div>
          <div><label>Default mode</label><select name="defaultMode">${['digital','analog'].map(v => `<option ${config.defaultMode===v?'selected':''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="row">
          <div><label>Control warn rate</label><input name="controlWarnRate" value="${esc(config.controlWarnRate ?? 10)}" /></div>
          <div><label>Status server</label><input name="statusServer" value="${esc(config.statusServer || '')}" /></div>
          <div><label>Upload server</label><input name="uploadServer" value="${esc(config.uploadServer || '')}" /></div>
          <div><label>Broadcastify server</label><input name="broadcastifyCallsServer" value="${esc(config.broadcastifyCallsServer || '')}" /></div>
        </div>

        <h2>Sources</h2>
        ${sources.map((s, i) => `
          <div class="subcard">
            <div class="actions" style="justify-content: space-between;">
              <strong>Source ${i + 1}</strong>
              <a class="btn light" href="/configurator/remove-source/${i}">Remove</a>
            </div>
            <div class="row">
              <div><label>Driver</label><select name="source_${i}_driver">${['osmosdr','usrp','iqfile','sigmffile'].map(v => `<option ${s.driver===v?'selected':''}>${v}</option>`).join('')}</select></div>
              <div><label>Device</label><input name="source_${i}_device" value="${esc(s.device || '')}" /></div>
              <div><label>Enabled</label><select name="source_${i}_enabled"><option ${s.enabled !== false ? 'selected' : ''}>true</option><option ${s.enabled === false ? 'selected' : ''}>false</option></select></div>
              <div><label>Antenna</label><input name="source_${i}_antenna" value="${esc(s.antenna || '')}" /></div>
            </div>
            <div class="row">
              <div><label>Center</label><input name="source_${i}_center" value="${esc(s.center || '')}" /></div>
              <div><label>Rate</label><input name="source_${i}_rate" value="${esc(s.rate || '')}" /></div>
              <div><label>Gain</label><input name="source_${i}_gain" value="${esc(s.gain || '')}" /></div>
              <div><label>AGC</label><select name="source_${i}_agc"><option ${s.agc ? 'selected' : ''}>true</option><option ${!s.agc ? 'selected' : ''}>false</option></select></div>
            </div>
            <div class="row">
              <div><label>Error</label><input name="source_${i}_error" value="${esc(s.error ?? 0)}" /></div>
              <div><label>PPM</label><input name="source_${i}_ppm" value="${esc(s.ppm ?? 0)}" /></div>
              <div><label>Digital recorders</label><input name="source_${i}_digitalRecorders" value="${esc(s.digitalRecorders || '')}" /></div>
              <div><label>Analog recorders</label><input name="source_${i}_analogRecorders" value="${esc(s.analogRecorders || '')}" /></div>
            </div>
          </div>
        `).join('')}
        <input type="hidden" name="source_count" value="${sources.length}" />

        <h2>Systems</h2>
        ${systems.map((s, i) => `
          <div class="subcard">
            <div class="actions" style="justify-content: space-between;">
              <strong>System ${i + 1}</strong>
              <a class="btn light" href="/configurator/remove-system/${i}">Remove</a>
            </div>
            <div class="row">
              <div><label>Type</label><select name="system_${i}_type">${['p25','smartnet'].map(v => `<option ${s.type===v?'selected':''}>${v}</option>`).join('')}</select></div>
              <div><label>Modulation</label><input name="system_${i}_modulation" value="${esc(s.modulation || 'qpsk')}" /></div>
              <div><label>Squelch</label><input name="system_${i}_squelch" value="${esc(s.squelch ?? -50)}" /></div>
              <div><label>Talkgroup display format</label><input name="system_${i}_shortName" value="${esc(s.shortName || '')}" placeholder="optional label" /></div>
            </div>
            <div class="row">
              <div><label>Control channels</label><input name="system_${i}_control_channels" value="${esc((s.control_channels || []).join(', '))}" /></div>
              <div><label>Talkgroups file</label><input name="system_${i}_talkgroupsFile" value="${esc(s.talkgroupsFile || '')}" /></div>
              <div><label>Unit tags file</label><input name="system_${i}_unitTagsFile" value="${esc(s.unitTagsFile || '')}" /></div>
              <div><label>Audio archive</label><select name="system_${i}_audioArchive"><option ${s.audioArchive ? 'selected' : ''}>true</option><option ${!s.audioArchive ? 'selected' : ''}>false</option></select></div>
            </div>
          </div>
        `).join('')}
        <input type="hidden" name="system_count" value="${systems.length}" />
        <button type="submit">Save Configurator Changes</button>
      </form>
    </div>
  `));
});

app.get('/configurator/add-source/:kind', (req, res) => {
  const config = readConfig();
  if (!Array.isArray(config.sources)) config.sources = [];
  config.sources.push(sourceTemplate(req.params.kind));
  writeConfig(config);
  res.redirect('/configurator');
});

app.get('/configurator/remove-source/:index', (req, res) => {
  const config = readConfig();
  const index = Number(req.params.index);
  if (Array.isArray(config.sources) && config.sources.length > 1) {
    config.sources.splice(index, 1);
    writeConfig(config);
  }
  res.redirect('/configurator');
});

app.get('/configurator/add-system/:kind', (req, res) => {
  const config = readConfig();
  if (!Array.isArray(config.systems)) config.systems = [];
  config.systems.push(systemTemplate(req.params.kind));
  writeConfig(config);
  res.redirect('/configurator');
});

app.get('/configurator/remove-system/:index', (req, res) => {
  const config = readConfig();
  const index = Number(req.params.index);
  if (Array.isArray(config.systems) && config.systems.length > 1) {
    config.systems.splice(index, 1);
    writeConfig(config);
  }
  res.redirect('/configurator');
});

app.post('/configurator', (req, res) => {
  const b = req.body;
  const config = readConfig();
  config.ver = 2;
  config.captureDir = b.captureDir || './data/recordings';
  config.logLevel = b.logLevel || 'info';
  config.callTimeout = Number(b.callTimeout || 3);
  config.defaultMode = b.defaultMode || 'digital';
  config.controlWarnRate = Number(b.controlWarnRate || 10);
  config.statusServer = b.statusServer || '';
  config.uploadServer = b.uploadServer || '';
  config.broadcastifyCallsServer = b.broadcastifyCallsServer || '';

  const sourceCount = Number(b.source_count || 0);
  config.sources = Array.from({ length: sourceCount }).map((_, i) => ({
    driver: b[`source_${i}_driver`],
    device: b[`source_${i}_device`] || '',
    enabled: b[`source_${i}_enabled`] !== 'false',
    antenna: b[`source_${i}_antenna`] || '',
    center: Number(b[`source_${i}_center`] || 0),
    rate: Number(b[`source_${i}_rate`] || 0),
    gain: Number(b[`source_${i}_gain`] || 0),
    agc: b[`source_${i}_agc`] === 'true',
    error: Number(b[`source_${i}_error`] || 0),
    ppm: Number(b[`source_${i}_ppm`] || 0),
    digitalRecorders: Number(b[`source_${i}_digitalRecorders`] || 0),
    analogRecorders: Number(b[`source_${i}_analogRecorders`] || 0)
  }));

  const systemCount = Number(b.system_count || 0);
  config.systems = Array.from({ length: systemCount }).map((_, i) => ({
    type: b[`system_${i}_type`],
    modulation: b[`system_${i}_modulation`] || 'qpsk',
    squelch: Number(b[`system_${i}_squelch`] || -50),
    shortName: b[`system_${i}_shortName`] || '',
    control_channels: String(b[`system_${i}_control_channels`] || '').split(',').map(v => v.trim()).filter(Boolean).map(v => Number(v)),
    talkgroupsFile: b[`system_${i}_talkgroupsFile`] || '',
    unitTagsFile: b[`system_${i}_unitTagsFile`] || '',
    audioArchive: b[`system_${i}_audioArchive`] === 'true'
  }));

  if (!Array.isArray(config.plugins)) config.plugins = [];
  writeConfig(config);
  res.redirect('/status');
});

app.get('/advanced', (req, res) => {
  const config = readConfig();
  const errors = validateConfig(config);
  res.send(page('Advanced JSON', `
    <div class="card">
      <h1 class="section-title">Advanced JSON</h1>
      ${errors.length ? errors.map(e => `<div class="error">${esc(e)}</div>`).join('') : '<div class="ok">Config passes lightweight validation.</div>'}
      <form method="post" action="/advanced">
        <label>config.json</label>
        <textarea name="json">${esc(JSON.stringify(config, null, 2))}</textarea>
        <br><br>
        <button type="submit">Save JSON</button>
      </form>
    </div>
  `));
});

app.post('/advanced', (req, res) => {
  try {
    const parsed = JSON.parse(req.body.json);
    writeConfig(parsed);
    res.redirect('/advanced');
  } catch (err) {
    res.status(400).send(page('Invalid JSON', `<div class="card"><h1>Invalid JSON</h1><div class="error">${esc(err.message)}</div><p><a href="/advanced">Go back</a></p></div>`));
  }
});

app.get('/status', (req, res) => {
  const config = readConfig();
  const errors = validateConfig(config);
  const ps = shell('docker compose ps');
  res.send(page('Status', `
    <div class="card">
      <h1 class="section-title">Status</h1>
      ${errors.length ? '<div class="error">Config has validation issues, fix those before relying on runtime.</div>' : '<div class="ok">Config looks valid enough for a first pass.</div>'}
      <p>
        <a class="btn" href="/compose/up">docker compose up -d</a>
        <a class="btn secondary" href="/compose/restart">restart</a>
        <a class="btn secondary" href="/compose/down">down</a>
      </p>
    </div>
    <div class="card">
      <h2 class="section-title">docker compose ps</h2>
      <pre>${esc(ps)}</pre>
    </div>
  `));
});

app.get('/logs', (req, res) => {
  const logs = shell('docker compose logs --tail=200');
  res.send(page('Logs', `
    <div class="card">
      <h1 class="section-title">Logs</h1>
      <p class="muted">Last 200 lines from docker compose.</p>
      <pre>${esc(logs)}</pre>
    </div>
  `));
});

app.get('/compose/:action', (req, res) => {
  const action = req.params.action;
  let output = '';
  if (action === 'up') output = shell('docker compose up -d');
  else if (action === 'restart') output = shell('docker compose restart');
  else if (action === 'down') output = shell('docker compose down');
  else output = 'Unknown action';
  res.send(page('Compose action', `<div class="card"><h1>${esc(action)}</h1><pre>${esc(output)}</pre><p><a class="btn" href="/status">Back to status</a></p></div>`));
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`webui listening on http://0.0.0.0:${port}`);
});

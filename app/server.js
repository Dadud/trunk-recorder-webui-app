import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const configDir = path.join(root, 'config');
const configPath = path.join(configDir, 'config.json');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(root, 'public')));

function ensureConfig() {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    const initial = {
      ver: 2,
      sources: [],
      systems: [],
      plugins: []
    };
    fs.writeFileSync(configPath, JSON.stringify(initial, null, 2));
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

function page(title, body) {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 0; background: #f7f7f8; color: #111; }
        .wrap { max-width: 980px; margin: 0 auto; padding: 24px; }
        .card { background: white; border-radius: 14px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
        .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; }
        input, select, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d0d5dd; border-radius: 10px; font: inherit; }
        textarea { min-height: 280px; font-family: ui-monospace, monospace; }
        button { background: #111827; color: white; border: 0; border-radius: 10px; padding: 10px 14px; font: inherit; cursor: pointer; }
        .muted { color: #555; }
        .nav a { margin-right: 12px; color: #111827; text-decoration: none; font-weight: 600; }
        code { background: #f0f2f5; padding: 2px 6px; border-radius: 6px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card nav">
          <a href="/">Overview</a>
          <a href="/wizard">Setup Wizard</a>
          <a href="/advanced">Advanced Config</a>
        </div>
        ${body}
      </div>
    </body>
  </html>`;
}

app.get('/', (req, res) => {
  const config = readConfig();
  res.send(page('Trunk Recorder Web UI', `
    <div class="card">
      <h1>Trunk Recorder Web UI</h1>
      <p class="muted">Lightweight setup and configuration for Trunk Recorder in Docker.</p>
    </div>
    <div class="card row">
      <div><strong>Sources</strong><br>${config.sources.length}</div>
      <div><strong>Systems</strong><br>${config.systems.length}</div>
      <div><strong>Plugins</strong><br>${config.plugins.length}</div>
    </div>
    <div class="card">
      <h2>How this is meant to feel</h2>
      <ul>
        <li>Wizard first, so setup is not painful</li>
        <li>Advanced editor for every Trunk Recorder option</li>
        <li>Simple Docker deployment</li>
      </ul>
    </div>
  `));
});

app.get('/wizard', (req, res) => {
  const config = readConfig();
  const source = config.sources[0] || {};
  const system = config.systems[0] || {};
  res.send(page('Setup Wizard', `
    <div class="card">
      <h1>Setup Wizard</h1>
      <p class="muted">This covers the common path first. Advanced options stay editable later.</p>
      <form method="post" action="/wizard">
        <div class="row">
          <div>
            <label>Capture directory</label>
            <input name="captureDir" value="${config.captureDir || './data/recordings'}" />
          </div>
          <div>
            <label>Log level</label>
            <select name="logLevel">
              ${['trace','debug','info','warning','error','fatal'].map(v => `<option ${config.logLevel===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="row">
          <div>
            <label>Source driver</label>
            <select name="source_driver">
              ${['osmosdr','usrp','iqfile','sigmffile'].map(v => `<option ${source.driver===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Device</label>
            <input name="source_device" value="${source.device || ''}" placeholder="rtl=0000001" />
          </div>
        </div>
        <div class="row">
          <div><label>Center frequency (Hz)</label><input name="source_center" value="${source.center || ''}" /></div>
          <div><label>Sample rate</label><input name="source_rate" value="${source.rate || ''}" /></div>
          <div><label>Gain</label><input name="source_gain" value="${source.gain || ''}" /></div>
        </div>
        <div class="row">
          <div><label>Error (Hz)</label><input name="source_error" value="${source.error ?? 0}" /></div>
          <div><label>PPM</label><input name="source_ppm" value="${source.ppm ?? 0}" /></div>
          <div><label>Digital recorders</label><input name="source_digitalRecorders" value="${source.digitalRecorders || 2}" /></div>
        </div>
        <div class="row">
          <div>
            <label>System type</label>
            <select name="system_type">
              ${['p25','smartnet'].map(v => `<option ${system.type===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Control channels (comma separated Hz)</label>
            <input name="system_control_channels" value="${(system.control_channels || []).join(', ')}" />
          </div>
          <div>
            <label>Modulation</label>
            <input name="system_modulation" value="${system.modulation || 'qpsk'}" />
          </div>
        </div>
        <div class="row">
          <div><label>Talkgroups file</label><input name="system_talkgroupsFile" value="${system.talkgroupsFile || 'talkgroups.csv'}" /></div>
          <div><label>Unit tags file</label><input name="system_unitTagsFile" value="${system.unitTagsFile || 'unit-tags.csv'}" /></div>
          <div><label>Squelch</label><input name="system_squelch" value="${system.squelch ?? -50}" /></div>
        </div>
        <button type="submit">Save Wizard Config</button>
      </form>
    </div>
  `));
});

app.post('/wizard', (req, res) => {
  const body = req.body;
  const config = readConfig();
  config.ver = 2;
  config.captureDir = body.captureDir || './data/recordings';
  config.logLevel = body.logLevel || 'info';
  config.sources = [{
    driver: body.source_driver,
    device: body.source_device || '',
    center: Number(body.source_center || 0),
    rate: Number(body.source_rate || 0),
    gain: Number(body.source_gain || 0),
    error: Number(body.source_error || 0),
    ppm: Number(body.source_ppm || 0),
    digitalRecorders: Number(body.source_digitalRecorders || 2),
    enabled: true
  }];
  config.systems = [{
    type: body.system_type,
    control_channels: String(body.system_control_channels || '').split(',').map(v => v.trim()).filter(Boolean).map(v => Number(v)),
    modulation: body.system_modulation || 'qpsk',
    talkgroupsFile: body.system_talkgroupsFile || 'talkgroups.csv',
    unitTagsFile: body.system_unitTagsFile || 'unit-tags.csv',
    squelch: Number(body.system_squelch || -50)
  }];
  if (!Array.isArray(config.plugins)) config.plugins = [];
  writeConfig(config);
  res.redirect('/advanced');
});

app.get('/advanced', (req, res) => {
  const config = readConfig();
  res.send(page('Advanced Config', `
    <div class="card">
      <h1>Advanced Config</h1>
      <p class="muted">Full Trunk Recorder config, editable as JSON.</p>
      <form method="post" action="/advanced">
        <label>config.json</label>
        <textarea name="json">${JSON.stringify(config, null, 2)}</textarea>
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
    res.status(400).send(page('Invalid JSON', `<div class="card"><h1>Invalid JSON</h1><p>${err.message}</p><p><a href="/advanced">Go back</a></p></div>`));
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`webui listening on http://0.0.0.0:${port}`);
});

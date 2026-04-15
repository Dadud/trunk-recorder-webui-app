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

// In-memory status store for trunk-recorder status
let trStatus = null;

function ensureConfig() {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({ ver: 2, sources: [], systems: [], plugins: [] }, null, 2));
}
function ensureTextFile(file, content = '') {
  const p = path.join(root, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, content);
  return p;
}
function readConfig() { ensureConfig(); return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
function writeConfig(config) { ensureConfig(); fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); }
function shell(cmd) {
  try { return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }
  catch (err) { return (err.stdout?.toString() || '') + (err.stderr?.toString() || err.message); }
}
function validateConfig(config) {
  const errors = [];
  if (config.ver !== 2) errors.push('Config version must be 2.');
  if (!Array.isArray(config.sources) || config.sources.length === 0) errors.push('Add at least one radio source.');
  if (!Array.isArray(config.systems) || config.systems.length === 0) errors.push('Add at least one radio system.');
  (config.sources || []).forEach((s, i) => {
    if (!s.driver) errors.push(`Source ${i + 1}: choose a driver.`);
    if (!s.center && !['iqfile','sigmffile'].includes(s.driver)) errors.push(`Source ${i + 1}: add a center frequency.`);
    if (!s.rate) errors.push(`Source ${i + 1}: add a sample rate.`);
    if (s.gain === undefined || s.gain === '') errors.push(`Source ${i + 1}: add a gain value.`);
  });
  (config.systems || []).forEach((s, i) => {
    if (!s.type) errors.push(`System ${i + 1}: choose a system type.`);
    if (!Array.isArray(s.control_channels) || s.control_channels.length === 0) errors.push(`System ${i + 1}: add at least one control channel.`);
    if (s.type === 'smartnet' && !s.modulation) errors.push(`System ${i + 1}: set modulation for this analog-capable system.`);
  });
  return errors;
}
function esc(str) { return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function sourceTemplate(kind='rtl') {
  if (kind==='rtl') return { driver:'osmosdr', device:'rtl=00000001', center:857000000, rate:2400000, gain:30, error:0, ppm:0, digitalRecorders:2, analogRecorders:0, enabled:true };
  if (kind==='airspy') return { driver:'osmosdr', device:'airspy', center:857000000, rate:10000000, gain:12, error:0, ppm:0, digitalRecorders:4, analogRecorders:0, enabled:true };
  if (kind==='rsp1b') return { driver:'osmosdr', device:'driver=sdrplay', center:857000000, rate:8000000, gain:30, error:0, ppm:0, digitalRecorders:4, analogRecorders:2, enabled:true };
  return { driver:'usrp', device:'', center:857000000, rate:8000000, gain:40, error:0, ppm:0, digitalRecorders:4, analogRecorders:0, enabled:true };
}
function systemTemplate(kind='p25') {
  if (kind==='smartnet') return { type:'smartnet', control_channels:[855462500], talkgroupsFile:'talkgroups.csv', unitTagsFile:'unit-tags.csv', squelch:-50, modulation:'qpsk', audioArchive:false };
  return { type:'p25', control_channels:[855462500], talkgroupsFile:'talkgroups.csv', unitTagsFile:'unit-tags.csv', squelch:-50, modulation:'qpsk', audioArchive:false };
}
function layout(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(title)}</title><style>
  body { font-family: Inter, system-ui, sans-serif; margin: 0; background: #f5f7fb; color: #101828; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 20px; }
  .header { background: white; border-radius: 18px; padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 2px 10px rgba(16,24,40,.06); }
  .brand { font-size: 20px; font-weight: 800; } .sub { color: #667085; margin-top: 4px; }
  .nav { margin-top: 14px; display: flex; gap: 14px; flex-wrap: wrap; } .nav a { text-decoration: none; color: #1d2939; font-weight: 700; }
  .card { background: white; border-radius: 18px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 10px rgba(16,24,40,.06); }
  .subcard { border: 1px solid #eaecf0; border-radius: 14px; padding: 16px; margin-bottom: 14px; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
  label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
  input, select, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d0d5dd; border-radius: 10px; font: inherit; background: #fff; }
  textarea { min-height: 280px; font-family: ui-monospace, monospace; }
  button, .btn { background: #334155; color: white; border: 0; border-radius: 10px; padding: 10px 14px; font: inherit; cursor: pointer; text-decoration: none; display: inline-block; }
  .btn.secondary { background: #64748b; } .btn.light { background: #e2e8f0; color: #0f172a; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .chip { display: inline-block; background: #eef2ff; color: #3730a3; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .muted { color: #667085; } .error { background: #fef3f2; color: #b42318; padding: 10px 12px; border-radius: 10px; margin-bottom: 8px; }
  .ok { background: #ecfdf3; color: #027a48; padding: 10px 12px; border-radius: 10px; margin-bottom: 8px; }
  .note { background: #f8fafc; color: #475467; padding: 12px; border-radius: 12px; }
  .steps { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; } .step { background:#eef2ff; color:#3730a3; padding:6px 10px; border-radius:999px; font-size:12px; font-weight:700; }
  .badge { display:inline-block; padding:3px 8px; border-radius:999px; font-size:11px; font-weight:700; background:#ecfdf3; color:#027a48; }
  pre { white-space: pre-wrap; word-break: break-word; background: #0b1020; color: #e5e7eb; padding: 14px; border-radius: 12px; overflow: auto; }
  h1,h2,h3 { margin-top: 0; } .footer-link { margin-top: 12px; }
  </style></head><body><div class="wrap"><div class="header"><div class="brand">Trunk Recorder Web UI</div><div class="sub">Tiny, friendly setup and runtime management for Trunk Recorder</div><div class="nav"><a href="/">Home</a><a href="/setup">Setup</a><a href="/configuration">Configuration</a><a href="/runtime">Runtime</a><a href="/files">Talkgroups & Tags</a></div></div>${body}</div></body></html>`;
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Receive status POST from trunk-recorder (SSE push or polling relay)
app.post('/api/status', (req, res) => {
  trStatus = req.body;
  res.json({ ok: true });
});

// Poll trunk-recorder's management API and return status
app.get('/api/tr-status', async (req, res) => {
  const config = readConfig();
  const apiUrl = config.trApiUrl;
  const apiToken = config.trApiToken;

  if (!apiUrl) {
    return res.json({ error: 'trApiUrl not configured in webui settings' });
  }

  try {
    const headers = {};
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

    // Try the management API runtime endpoint
    const rtRes = await fetch(`${apiUrl}/api/v1/runtime`, { headers, signal: AbortSignal.timeout(5000) });
    if (rtRes.ok) {
      const data = await rtRes.json();
      return res.json({ connected: true, apiEnabled: data.apiEnabled, reloadRequested: data.reloadRequested, configPath: data.configPath });
    }
    return res.json({ connected: false, error: `HTTP ${rtRes.status}` });
  } catch (err) {
    return res.json({ connected: false, error: err.message });
  }
});

// ─── Pages ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  const config = readConfig();
  const errors = validateConfig(config);
  const isValid = errors.length === 0;
  const ps = shell('docker compose ps');
  const running = /Up|running/i.test(ps);
  res.send(layout('Home', `
    <div class="card"><h1>Home</h1><p class="muted">Quick snapshot of setup, health, and next steps.</p>${isValid ? '<div class="chip">Config looks valid</div>' : '<div class="chip">Setup needed</div>'} ${running ? '<span class="badge">Services running</span>' : ''}</div>
    <div class="card row"><div><strong>Sources</strong><br>${config.sources?.length || 0}</div><div><strong>Systems</strong><br>${config.systems?.length || 0}</div><div><strong>Default call mode</strong><br>${esc(config.defaultMode || 'digital')}</div><div><strong>Capture path</strong><br><code>${esc(config.captureDir || './data/recordings')}</code></div></div>
    <div class="card"><h2>Checklist</h2><div class="steps"><div class="step">1. Choose template</div><div class="step">2. Configure source</div><div class="step">3. Configure system</div><div class="step">4. Review talkgroups</div><div class="step">5. Start services</div></div><div class="actions"><a class="btn" href="/setup">Open Quick Setup</a><a class="btn secondary" href="/configuration">Open Configuration</a><a class="btn light" href="/runtime">Open Runtime</a></div></div>
    <div class="card"><h2>Validation</h2>${errors.length ? errors.map(e => `<div class="error">${esc(e)}</div>`).join('') : '<div class="ok">No obvious config problems found.</div>'}</div>
  `));
});

app.get('/setup', (req, res) => {
  const config = readConfig();
  const source = config.sources?.[0] || {};
  const system = config.systems?.[0] || {};
  res.send(layout('Setup', `
    <div class="card"><h1>Quick Setup</h1><p class="muted">A guided setup flow for the common path.</p><div class="steps"><div class="step">1. Template</div><div class="step">2. Radio source</div><div class="step">3. System details</div><div class="step">4. Storage & review</div></div></div>
    <div class="card"><h2>1. Choose a template</h2><p class="muted">Start with a template if you want the easiest path.</p><div class="actions"><a class="btn" href="/template/rtl-p25">RTL-SDR + P25 <span class="badge">recommended</span></a><a class="btn secondary" href="/template/airspy-p25">Airspy + P25</a><a class="btn secondary" href="/template/rsp1b-p25">RSP1B + P25</a><a class="btn light" href="/template/usrp-p25">USRP + P25</a><a class="btn light" href="/template/rtl-smartnet">RTL-SDR + SmartNet / analog</a></div></div>
    <form method="post" action="/setup">
      <div class="card"><h2>2. Radio source</h2><div class="row"><div><label>Driver</label><select name="source_driver">${['osmosdr','usrp','iqfile','sigmffile'].map(v => `<option ${source.driver===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label>Device</label><input name="source_device" value="${esc(source.device || '')}" placeholder="rtl=0000001" /></div><div><label>Center frequency</label><input name="source_center" value="${esc(source.center || '')}" /></div></div><div class="row"><div><label>Sample rate</label><input name="source_rate" value="${esc(source.rate || '')}" /></div><div><label>Gain</label><input name="source_gain" value="${esc(source.gain || '')}" /></div><div><label>Error (Hz)</label><input name="source_error" value="${esc(source.error ?? 0)}" /></div></div><div class="row"><div><label>PPM</label><input name="source_ppm" value="${esc(source.ppm ?? 0)}" /></div><div><label>Digital channels</label><input name="source_digitalRecorders" value="${esc(source.digitalRecorders || 2)}" /></div><div><label>Analog channels</label><input name="source_analogRecorders" value="${esc(source.analogRecorders || 0)}" /></div></div></div>
      <div class="card"><h2>3. System details</h2><p class="muted">Use analog if this system carries analog voice traffic by default.</p><div class="row"><div><label>System type</label><select name="system_type">${['p25','smartnet'].map(v => `<option ${system.type===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label>Default call mode</label><select name="defaultMode">${['digital','analog'].map(v => `<option ${config.defaultMode===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label>Control channel frequencies</label><input name="system_control_channels" value="${esc((system.control_channels || []).join(', '))}" /></div></div><div class="row"><div><label>Modulation</label><input name="system_modulation" value="${esc(system.modulation || 'qpsk')}" /></div><div><label>Squelch</label><input name="system_squelch" value="${esc(system.squelch ?? -50)}" /></div><div><label>Talkgroups CSV</label><input name="system_talkgroupsFile" value="${esc(system.talkgroupsFile || 'talkgroups.csv')}" /></div></div><div class="row"><div><label>Unit tags CSV</label><input name="system_unitTagsFile" value="${esc(system.unitTagsFile || 'unit-tags.csv')}" /></div></div></div>
      <div class="card"><h2>4. Storage and review</h2><div class="row"><div><label>Capture directory</label><input name="captureDir" value="${esc(config.captureDir || './data/recordings')}" /></div><div><label>Log level</label><select name="logLevel">${['trace','debug','info','warning','error','fatal'].map(v => `<option ${config.logLevel===v?'selected':''}>${v}</option>`).join('')}</select></div></div><div class="note">You can fine-tune everything later in Configuration. Raw Config is there for power users only.</div><div class="actions"><button type="submit">Save Quick Setup</button><a class="btn light" href="/configuration">Skip to full configuration</a></div></div>
    </form>
  `));
});

app.post('/setup', (req, res) => {
  const b = req.body; const config = readConfig();
  config.ver = 2; config.captureDir = b.captureDir || './data/recordings'; config.logLevel = b.logLevel || 'info'; config.defaultMode = b.defaultMode || 'digital';
  config.sources = [{ driver: b.source_driver, device: b.source_device || '', center: Number(b.source_center || 0), rate: Number(b.source_rate || 0), gain: Number(b.source_gain || 0), error: Number(b.source_error || 0), ppm: Number(b.source_ppm || 0), digitalRecorders: Number(b.source_digitalRecorders || 2), analogRecorders: Number(b.source_analogRecorders || 0), enabled: true }];
  config.systems = [{ type: b.system_type, control_channels: String(b.system_control_channels || '').split(',').map(v => v.trim()).filter(Boolean).map(v => Number(v)), modulation: b.system_modulation || 'qpsk', talkgroupsFile: b.system_talkgroupsFile || 'talkgroups.csv', unitTagsFile: b.system_unitTagsFile || 'unit-tags.csv', squelch: Number(b.system_squelch || -50), audioArchive: false }];
  config.plugins = config.plugins || []; writeConfig(config); res.redirect('/configuration');
});

app.get('/template/:name', (req, res) => {
  const config = readConfig(); const name = req.params.name;
  config.ver = 2; config.captureDir = './data/recordings'; config.logLevel = 'info'; config.callTimeout = 3; config.plugins = config.plugins || [];
  if (name === 'rtl-p25') { config.defaultMode = 'digital'; config.sources = [sourceTemplate('rtl')]; config.systems = [systemTemplate('p25')]; }
  else if (name === 'airspy-p25') { config.defaultMode = 'digital'; config.sources = [sourceTemplate('airspy')]; config.systems = [systemTemplate('p25')]; }
  else if (name === 'rsp1b-p25') { config.defaultMode = 'digital'; config.sources = [sourceTemplate('rsp1b')]; config.systems = [systemTemplate('p25')]; }
  else if (name === 'rtl-smartnet') { config.defaultMode = 'analog'; const src = sourceTemplate('rtl'); src.analogRecorders = 2; config.sources = [src]; config.systems = [systemTemplate('smartnet')]; }
  else { config.defaultMode = 'digital'; config.sources = [sourceTemplate('usrp')]; config.systems = [systemTemplate('p25')]; }
  writeConfig(config); res.redirect('/configuration');
});

app.get('/configuration', (req, res) => {
  const config = readConfig(); const sources = config.sources?.length ? config.sources : [sourceTemplate('rtl')]; const systems = config.systems?.length ? config.systems : [systemTemplate('p25')];
  res.send(layout('Configuration', `
    <div class="card"><h1>Configuration</h1><p class="muted">Structured editing for the real config.</p><div class="actions"><a class="btn light" href="/configurator/add-source/rtl">Add RTL source</a><a class="btn light" href="/configurator/add-source/airspy">Add Airspy source</a><a class="btn light" href="/configurator/add-source/rsp1b">Add RSP1B source</a><a class="btn light" href="/configurator/add-source/usrp">Add USRP source</a><a class="btn light" href="/configurator/add-system/p25">Add P25 system</a><a class="btn light" href="/configurator/add-system/smartnet">Add SmartNet system</a></div></div>
    <div class="card"><form method="post" action="/configuration"><h2>General</h2><div class="row"><div><label>Capture directory</label><input name="captureDir" value="${esc(config.captureDir || './data/recordings')}" /></div><div><label>Log level</label><select name="logLevel">${['trace','debug','info','warning','error','fatal'].map(v => `<option ${config.logLevel===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label>Call timeout</label><input name="callTimeout" value="${esc(config.callTimeout ?? 3)}" /></div><div><label>Default call mode</label><select name="defaultMode">${['digital','analog'].map(v => `<option ${config.defaultMode===v?'selected':''}>${v}</option>`).join('')}</select></div></div><div class="row"><div><label>Control warn rate</label><input name="controlWarnRate" value="${esc(config.controlWarnRate ?? 10)}" /></div><div><label>Status server</label><input name="statusServer" value="${esc(config.statusServer || '')}" /></div><div><label>Upload server</label><input name="uploadServer" value="${esc(config.uploadServer || '')}" /></div><div><label>Broadcastify server</label><input name="broadcastifyCallsServer" value="${esc(config.broadcastifyCallsServer || '')}" /></div></div>
    <div class="card"><h2>Trunk-Recorder Connection</h2><p class="muted">Tell the webui how to reach trunk-recorder's management API for status display.</p><div class="row"><div><label>TR API URL (e.g. http://192.168.1.168:8765)</label><input name="trApiUrl" value="${esc(config.trApiUrl || '')}" placeholder="http://192.168.1.168:8765" /></div><div><label>TR API Token</label><input name="trApiToken" value="${esc(config.trApiToken || '')}" placeholder="API token" /></div></div></div>
    <h2>Sources</h2>${sources.map((s, i) => `<div class="subcard"><div class="actions" style="justify-content: space-between;"><strong>Source ${i + 1}</strong><a class="btn light" href="/configurator/remove-source/${i}">Remove</a></div><div class="row"><div><label>Driver</label><select name="source_${i}_driver">${['osmosdr','usrp','iqfile','sigmffile'].map(v => `<option ${s.driver===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label>Device</label><input name="source_${i}_device" value="${esc(s.device || '')}" /></div><div><label>Enabled</label><select name="source_${i}_enabled"><option ${s.enabled !== false ? 'selected' : ''}>true</option><option ${s.enabled === false ? 'selected' : ''}>false</option></select></div><div><label>Antenna</label><input name="source_${i}_antenna" value="${esc(s.antenna || '')}" /></div></div><div class="row"><div><label>Center frequency</label><input name="source_${i}_center" value="${esc(s.center || '')}" /></div><div><label>Sample rate</label><input name="source_${i}_rate" value="${esc(s.rate || '')}" /></div><div><label>Gain</label><input name="source_${i}_gain" value="${esc(s.gain || '')}" /></div><div><label>AGC</label><select name="source_${i}_agc"><option ${s.agc ? 'selected' : ''}>true</option><option ${!s.agc ? 'selected' : ''}>false</option></select></div></div><div class="row"><div><label>Error</label><input name="source_${i}_error" value="${esc(s.error ?? 0)}" /></div><div><label>PPM</label><input name="source_${i}_ppm" value="${esc(s.ppm ?? 0)}" /></div><div><label>Digital channels</label><input name="source_${i}_digitalRecorders" value="${esc(s.digitalRecorders || '')}" /></div><div><label>Analog channels</label><input name="source_${i}_analogRecorders" value="${esc(s.analogRecorders || '')}" /></div></div></div>`).join('')}<input type="hidden" name="source_count" value="${sources.length}" />
    <h2>Systems</h2>${systems.map((s, i) => `<div class="subcard"><div class="actions" style="justify-content: space-between;"><strong>System ${i + 1}</strong><a class="btn light" href="/configurator/remove-system/${i}">Remove</a></div><div class="row"><div><label>Type</label><select name="system_${i}_type">${['p25','smartnet'].map(v => `<option ${s.type===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label>Modulation</label><input name="system_${i}_modulation" value="${esc(s.modulation || 'qpsk')}" /></div><div><label>Squelch</label><input name="system_${i}_squelch" value="${esc(s.squelch ?? -50)}" /></div><div><label>Short label</label><input name="system_${i}_shortName" value="${esc(s.shortName || '')}" /></div></div><div class="row"><div><label>Control channel frequencies</label><input name="system_${i}_control_channels" value="${esc((s.control_channels || []).join(', '))}" /></div><div><label>Talkgroups CSV</label><input name="system_${i}_talkgroupsFile" value="${esc(s.talkgroupsFile || '')}" /></div><div><label>Unit tags CSV</label><input name="system_${i}_unitTagsFile" value="${esc(s.unitTagsFile || '')}" /></div><div><label>Audio archive</label><select name="system_${i}_audioArchive"><option ${s.audioArchive ? 'selected' : ''}>true</option><option ${!s.audioArchive ? 'selected' : ''}>false</option></select></div></div><div class="actions"><a class="btn light" href="/files?system=${i}">Edit files for this system</a></div></div>`).join('')}<input type="hidden" name="system_count" value="${systems.length}" />
    <div class="actions"><button type="submit">Save Configuration</button></div></form><div class="footer-link"><a href="/advanced">Raw Config</a></div></div>
  `));
});

app.post('/configuration', (req, res) => {
  const b = req.body; const config = readConfig();
  config.ver = 2; config.captureDir = b.captureDir || './data/recordings'; config.logLevel = b.logLevel || 'info'; config.callTimeout = Number(b.callTimeout || 3); config.defaultMode = b.defaultMode || 'digital'; config.controlWarnRate = Number(b.controlWarnRate || 10); config.statusServer = b.statusServer || ''; config.uploadServer = b.uploadServer || ''; config.broadcastifyCallsServer = b.broadcastifyCallsServer || ''; config.trApiUrl = b.trApiUrl || ''; config.trApiToken = b.trApiToken || '';
  const sourceCount = Number(b.source_count || 0);
  config.sources = Array.from({ length: sourceCount }).map((_, i) => ({ driver: b[`source_${i}_driver`], device: b[`source_${i}_device`] || '', enabled: b[`source_${i}_enabled`] !== 'false', antenna: b[`source_${i}_antenna`] || '', center: Number(b[`source_${i}_center`] || 0), rate: Number(b[`source_${i}_rate`] || 0), gain: Number(b[`source_${i}_gain`] || 0), agc: b[`source_${i}_agc`] === 'true', error: Number(b[`source_${i}_error`] || 0), ppm: Number(b[`source_${i}_ppm`] || 0), digitalRecorders: Number(b[`source_${i}_digitalRecorders`] || 0), analogRecorders: Number(b[`source_${i}_analogRecorders`] || 0) }));
  const systemCount = Number(b.system_count || 0);
  config.systems = Array.from({ length: systemCount }).map((_, i) => ({ type: b[`system_${i}_type`], modulation: b[`system_${i}_modulation`] || 'qpsk', squelch: Number(b[`system_${i}_squelch`] || -50), shortName: b[`system_${i}_shortName`] || '', control_channels: String(b[`system_${i}_control_channels`] || '').split(',').map(v => v.trim()).filter(Boolean).map(v => Number(v)), talkgroupsFile: b[`system_${i}_talkgroupsFile`] || '', unitTagsFile: b[`system_${i}_unitTagsFile`] || '', audioArchive: b[`system_${i}_audioArchive`] === 'true' }));
  if (!Array.isArray(config.plugins)) config.plugins = [];
  writeConfig(config); res.redirect('/runtime');
});

app.get('/files', (req, res) => {
  const config = readConfig();
  const systemIndex = Number(req.query.system ?? 0);
  const system = config.systems?.[systemIndex] || config.systems?.[0] || systemTemplate('p25');
  const tgFile = system.talkgroupsFile || `talkgroups-${systemIndex + 1}.csv`;
  const utFile = system.unitTagsFile || `unit-tags-${systemIndex + 1}.csv`;
  ensureTextFile(tgFile, 'Decimal,AlphaTag,Description,Mode\n1001,Dispatch,Main Dispatch,D\n2001,AnalogOps,Analog Operations,A\n');
  ensureTextFile(utFile, 'Radio ID,Tag\n12345,Car 1\n');
  const tg = fs.readFileSync(path.join(root, tgFile), 'utf8');
  const ut = fs.readFileSync(path.join(root, utFile), 'utf8');
  res.send(layout('Talkgroups & Tags', `
    <div class="card"><h1>Talkgroups & Tags</h1><p class="muted">Edit helper CSV files for system ${systemIndex + 1}. Use <code>D</code> for digital and <code>A</code> for analog in the <code>Mode</code> column when needed.</p></div>
    <div class="card"><form method="post" action="/files"><input type="hidden" name="systemIndex" value="${systemIndex}" /><div class="row"><div><label>Talkgroups CSV path</label><input name="talkgroupsPath" value="${esc(tgFile)}" /></div><div><label>Unit tags CSV path</label><input name="unitTagsPath" value="${esc(utFile)}" /></div></div><label>Talkgroups CSV</label><textarea name="talkgroupsCsv">${esc(tg)}</textarea><label>Unit tags CSV</label><textarea name="unitTagsCsv">${esc(ut)}</textarea><div class="actions"><button type="submit">Save CSV files</button></div></form></div>
  `));
});

app.post('/files', (req, res) => {
  const systemIndex = Number(req.body.systemIndex || 0);
  const tgPath = req.body.talkgroupsPath || `talkgroups-${systemIndex + 1}.csv`;
  const utPath = req.body.unitTagsPath || `unit-tags-${systemIndex + 1}.csv`;
  ensureTextFile(tgPath); ensureTextFile(utPath);
  fs.writeFileSync(path.join(root, tgPath), req.body.talkgroupsCsv || '');
  fs.writeFileSync(path.join(root, utPath), req.body.unitTagsCsv || '');
  const config = readConfig();
  if (config.systems?.[systemIndex]) {
    config.systems[systemIndex].talkgroupsFile = tgPath;
    config.systems[systemIndex].unitTagsFile = utPath;
    writeConfig(config);
  }
  res.redirect(`/files?system=${systemIndex}`);
});

app.get('/advanced', (req, res) => {
  const config = readConfig(); const errors = validateConfig(config);
  res.send(layout('Raw Config', `<div class="card"><h1>Raw Config</h1><p class="muted">For power users. Most setups should not need this page.</p>${errors.length ? errors.map(e => `<div class="error">${esc(e)}</div>`).join('') : '<div class="ok">Config passes lightweight validation.</div>'}<form method="post" action="/advanced"><label>config.json</label><textarea name="json">${esc(JSON.stringify(config, null, 2))}</textarea><div class="actions"><button type="submit">Save raw config</button></div></form></div>`));
});
app.post('/advanced', (req, res) => { try { const parsed = JSON.parse(req.body.json); writeConfig(parsed); res.redirect('/advanced'); } catch (err) { res.status(400).send(layout('Invalid JSON', `<div class="card"><h1>Invalid JSON</h1><div class="error">${esc(err.message)}</div><p><a href="/advanced">Go back</a></p></div>`)); } });

app.get('/runtime', async (req, res) => {
  const errors = validateConfig(readConfig());
  const ps = shell('docker compose ps');
  const logs = shell('docker compose logs --tail=120');
  const running = /Up|running/i.test(ps);
  const trunkRunning = /trunk-recorder.*(Up|running)/i.test(ps);
  const webRunning = /webui.*(Up|running)|trunk-recorder-webui.*(Up|running)/i.test(ps);

  // Try to get trunk-recorder status via API
  let trConnected = false;
  let trInfo = null;
  try {
    const config = readConfig();
    if (config.trApiUrl) {
      const headers = {};
      if (config.trApiToken) headers['Authorization'] = `Bearer ${config.trApiToken}`;
      const rtRes = await fetch(`${config.trApiUrl}/api/v1/runtime`, { headers, signal: AbortSignal.timeout(5000) });
      if (rtRes.ok) {
        trConnected = true;
        trInfo = await rtRes.json();
      }
    }
  } catch (_) {}

  res.send(layout('Runtime', `
    <div class="card"><h1>Runtime</h1>${errors.length ? '<div class="error">Fix the configuration warnings before relying on runtime behavior.</div>' : '<div class="ok">Configuration looks valid enough for a first run.</div>'}<div class="actions"><a class="btn" href="/compose/up">Start services</a><a class="btn secondary" href="/compose/restart">Restart services</a><a class="btn light" href="/compose/down">Stop services</a></div></div>
    <div class="card row"><div><strong>Overall</strong><br>${running ? '<span class="badge">Running</span>' : 'Stopped'}</div><div><strong>Trunk Recorder</strong><br>${trunkRunning ? '<span class="badge">Running</span>' : trConnected ? '<span class="badge">API Connected</span>' : 'Not running'}</div><div><strong>Web UI</strong><br>${webRunning ? '<span class="badge">Running</span>' : 'Not running'}</div></div>
    ${trConnected ? `<div class="card"><h2>Trunk-Recorder Status</h2><div class="ok">Connected to TR API — ${trInfo.configPath || 'config loaded'}</div></div>` : ''}
    <div class="card"><h2>Service status</h2><pre>${esc(ps)}</pre></div>
    <div class="card"><h2>Recent logs</h2><pre>${esc(logs)}</pre></div>
  `));
});

app.get('/compose/:action', (req, res) => {
  const action = req.params.action; let output = '';
  if (action === 'up') output = shell('docker compose up -d');
  else if (action === 'restart') output = shell('docker compose restart');
  else if (action === 'down') output = shell('docker compose down');
  else output = 'Unknown action';
  res.send(layout('Compose action', `<div class="card"><h1>${esc(action)}</h1><pre>${esc(output)}</pre><p><a class="btn" href="/runtime">Back to runtime</a></p></div>`));
});

app.get('/configurator/add-source/:kind', (req, res) => { const config = readConfig(); if (!Array.isArray(config.sources)) config.sources = []; config.sources.push(sourceTemplate(req.params.kind)); writeConfig(config); res.redirect('/configuration'); });
app.get('/configurator/remove-source/:index', (req, res) => { const config = readConfig(); const index = Number(req.params.index); if (Array.isArray(config.sources) && config.sources.length > 1) { config.sources.splice(index, 1); writeConfig(config); } res.redirect('/configuration'); });
app.get('/configurator/add-system/:kind', (req, res) => { const config = readConfig(); if (!Array.isArray(config.systems)) config.systems = []; config.systems.push(systemTemplate(req.params.kind)); writeConfig(config); res.redirect('/configuration'); });
app.get('/configurator/remove-system/:index', (req, res) => { const config = readConfig(); const index = Number(req.params.index); if (Array.isArray(config.systems) && config.systems.length > 1) { config.systems.splice(index, 1); writeConfig(config); } res.redirect('/configuration'); });

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`webui listening on http://0.0.0.0:${port}`));

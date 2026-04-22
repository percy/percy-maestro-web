const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const CDP = require('chrome-remote-interface');
const utils = require('@percy/sdk-utils');
const log = require('../util/log');

const sdkPkg = require('../../package.json');
const DEFAULT_PORT = 5339;
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;

function detectMaestroVersion() {
  if (process.env.MAESTRO_VERSION) return process.env.MAESTRO_VERSION;

  const candidateDirs = [
    path.join(os.homedir(), '.maestro', 'lib'),
    '/usr/local/lib/maestro',
    '/opt/maestro/lib'
  ];
  for (const dir of candidateDirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const m = name.match(/^maestro-cli-(\d+\.\d+\.\d+)\.jar$/);
        if (m) return m[1];
      }
    } catch { /* not a maestro install path */ }
  }

  try {
    const out = execSync('maestro --version', { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

const ENV_INFO = `maestro/${detectMaestroVersion()}`;

async function findChromiumDevToolsPort() {
  const candidates = await scanUserDataDirs();
  for (const dir of candidates) {
    const portFile = path.join(dir, 'DevToolsActivePort');
    if (fs.existsSync(portFile)) {
      const content = fs.readFileSync(portFile, 'utf8').trim().split('\n');
      const port = Number(content[0]);
      if (Number.isInteger(port) && port > 0) return port;
    }
  }
  throw new Error('Could not find Chromium DevTools port. Is Maestro web driver running?');
}

async function scanUserDataDirs() {
  const roots = [os.tmpdir(), '/var/folders'];
  const matches = [];
  for (const root of roots) {
    try { await walk(root, 3, matches); } catch { /* ignore */ }
  }
  return matches.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

async function walk(dir, depth, acc) {
  if (depth <= 0) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('org.chromium.Chromium.scoped_dir')) {
        acc.push(full);
      } else {
        walk(full, depth - 1, acc);
      }
    }
  }
}

async function captureAndUpload({ name, options = {} }) {
  if (!name) throw new Error('name is required');

  // Merge defaults from .percy.yml (snapshot config section) under per-call options.
  // Per-call env vars win over project config; project config wins over SDK defaults.
  const projectDefaults = (utils.percy && utils.percy.config && utils.percy.config.snapshot) || {};
  options = { ...projectDefaults, ...options };

  const port = await findChromiumDevToolsPort();
  log.debug(`connecting to Chromium DevTools on port ${port}`);

  const client = await CDP({ port });
  try {
    const { Runtime, Page, Network, Emulation } = client;
    await Runtime.enable();
    await Page.enable();
    await Network.enable();

    const domScript = fs.readFileSync(require.resolve('@percy/dom'), 'utf8');
    const responsive = options.responsiveSnapshotCapture && Array.isArray(options.widths) && options.widths.length > 1;

    let domSnapshot;
    if (responsive) {
      domSnapshot = await captureResponsive({ Runtime, Emulation, domScript, options });
    } else {
      const { result } = await Runtime.evaluate({
        expression: `${domScript}; PercyDOM.serialize(${JSON.stringify(options)})`,
        returnByValue: true,
        awaitPromise: true
      });
      domSnapshot = result.value;
    }

    const currentUrl = await getCurrentUrl(Runtime);
    domSnapshot.cookies = await getCookies(Network);

    try {
      const corsFrames = await captureCrossOriginIframes({ client, Runtime, domScript, options, pageUrl: currentUrl });
      if (corsFrames.length) {
        domSnapshot.corsIframes = corsFrames;
        log.debug(`[${name}] captured ${corsFrames.length} cross-origin iframe(s)`);
      }
    } catch (e) {
      log.debug(`cross-origin iframe capture skipped: ${e.message}`);
    }

    log.info(`[${name}] captured DOM — posting to Percy`);
    const response = await utils.postSnapshot({
      ...options,
      name,
      url: options.url || currentUrl,
      domSnapshot,
      clientInfo: CLIENT_INFO,
      environmentInfo: ENV_INFO
    });
    return response;
  } finally {
    await client.close();
  }
}

async function getCookies(Network) {
  try {
    const { cookies } = await Network.getAllCookies();
    return cookies || [];
  } catch {
    return [];
  }
}

async function captureCrossOriginIframes({ client, Runtime, domScript, options, pageUrl }) {
  let pageOrigin;
  try { pageOrigin = new URL(pageUrl).origin; } catch { return []; }

  const { targetInfos } = await client.send('Target.getTargets');
  const iframes = targetInfos.filter((t) => {
    if (t.type !== 'iframe' || !t.url || t.url === 'about:blank') return false;
    try { return new URL(t.url).origin !== pageOrigin; } catch { return false; }
  });
  if (!iframes.length) return [];

  const elementIdScript = 'JSON.stringify(Array.from(document.querySelectorAll(\'iframe\')).map(function(i){return {url:i.src,id:i.getAttribute(\'data-percy-element-id\')};}))';
  const { result: idsRaw } = await Runtime.evaluate({ expression: elementIdScript, returnByValue: true });
  let iframeIdMap = [];
  try { iframeIdMap = JSON.parse(idsRaw.value || '[]'); } catch { /* ignore */ }

  const results = [];
  const iframeOptions = { ...options, enableJavaScript: true };

  for (const frame of iframes) {
    try {
      const { sessionId } = await client.send('Target.attachToTarget', { targetId: frame.targetId, flatten: true });

      const res = await client.send('Runtime.evaluate', {
        expression: `${domScript}; PercyDOM.serialize(${JSON.stringify(iframeOptions)})`,
        returnByValue: true,
        awaitPromise: true
      }, sessionId);

      const match = iframeIdMap.find((i) => i.url && frame.url && i.url === frame.url);
      results.push({
        frameUrl: frame.url,
        iframeSnapshot: res.result.value,
        iframeData: match ? { percyElementId: match.id } : null
      });

      try { await client.send('Target.detachFromTarget', { sessionId }); } catch { /* ignore */ }
    } catch (e) {
      log.debug(`cors iframe ${frame.url} failed: ${e.message}`);
    }
  }
  return results;
}

async function captureResponsive({ Runtime, Emulation, domScript, options }) {
  const snapshots = [];
  const height = options.minHeight || 1024;

  for (const width of options.widths) {
    try {
      await Emulation.setDeviceMetricsOverride({
        width, height, deviceScaleFactor: 1, mobile: false
      });
      await new Promise(resolve => setTimeout(resolve, 200));

      const { result } = await Runtime.evaluate({
        expression: `${domScript}; PercyDOM.serialize(${JSON.stringify({ ...options, widths: [width] })})`,
        returnByValue: true,
        awaitPromise: true
      });
      snapshots.push({ width, snapshot: result.value });
    } catch (e) {
      log.debug(`responsive capture at width ${width} failed: ${e.message}`);
    }
  }

  try { await Emulation.clearDeviceMetricsOverride(); } catch { /* ignore */ }

  const first = snapshots[0]?.snapshot || {};
  return { ...first, responsiveSnapshots: snapshots };
}

async function getCurrentUrl(Runtime) {
  const { result } = await Runtime.evaluate({ expression: 'window.location.href' });
  return result.value;
}

function startServer({ port = DEFAULT_PORT } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthcheck') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'percy-maestro capture' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/snapshot') {
      try {
        const body = await readBody(req);
        const parsed = body ? JSON.parse(body) : {};
        const result = await captureAndUpload(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, name: parsed.name, result }));
      } catch (e) {
        log.error(`capture failed: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      log.info(`percy-maestro capture server listening on http://localhost:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = { startServer, captureAndUpload, findChromiumDevToolsPort };

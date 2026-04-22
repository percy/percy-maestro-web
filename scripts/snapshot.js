// Maestro runScript — posts a DOM snapshot request to the percy-maestro
// capture server running on localhost:5339. The server connects to Maestro's
// Chromium via CDP, serializes DOM with @percy/dom, and posts it to the
// Percy server started by `percy exec` (or `percy-maestro exec`).
//
// Env-var names are case-insensitive and accepted with or without the
// PERCY_SNAPSHOT_ prefix. NAME is the only required field. Defaults for
// widths / minHeight / percyCSS / etc. live in .percy.yml at the project
// root — the capture server reads them and merges them into every call.
//
// Minimum YAML usage:
//
//   - runScript:
//       file: ../node_modules/@percy/maestro/scripts/snapshot.js
//       env:
//         NAME: "Home screen"
//
// With overrides:
//
//   - runScript:
//       file: ../node_modules/@percy/maestro/scripts/snapshot.js
//       env:
//         NAME: "Home screen"
//         WIDTHS: "375,1280"
//         TEST_CASE: "homepage-suite"
//         REGIONS: '[{"algorithm":"ignore","elementSelector":{"elementCSS":".ad"}}]'

function readEnv(shortKey) {
  var longKey = 'PERCY_SNAPSHOT_' + shortKey;
  if (typeof globalThis !== 'undefined') {
    if (globalThis[shortKey] !== undefined && globalThis[shortKey] !== null && globalThis[shortKey] !== '') return globalThis[shortKey];
    if (globalThis[longKey] !== undefined && globalThis[longKey] !== null && globalThis[longKey] !== '') return globalThis[longKey];
  }
  // Fallback for GraalJS runtimes that don't expose globalThis
  try {
    /* eslint-disable-next-line no-eval */
    var shortVal = eval(shortKey);
    if (shortVal !== undefined && shortVal !== '') return shortVal;
  } catch (e) {}
  try {
    /* eslint-disable-next-line no-eval */
    var longVal = eval(longKey);
    if (longVal !== undefined && longVal !== '') return longVal;
  } catch (e) {}
  return undefined;
}

var snapshotName = readEnv('NAME') || 'unnamed';

var options = {};
var widthsRaw = readEnv('WIDTHS');
if (widthsRaw) options.widths = String(widthsRaw).split(',').map(function (w) { return Number(String(w).trim()); });

var minHeight = readEnv('MIN_HEIGHT');
if (minHeight) options.minHeight = Number(minHeight);

var percyCSS = readEnv('PERCY_CSS');
if (percyCSS) options.percyCSS = String(percyCSS);

var scope = readEnv('SCOPE');
if (scope) options.scope = String(scope);

var enableJS = readEnv('ENABLE_JS');
if (String(enableJS) === 'true') options.enableJavaScript = true;

var regions = readEnv('REGIONS');
if (regions) { try { options.regions = JSON.parse(String(regions)); } catch (e) {} }

// Legacy (still honored, not preferred)
var ignoreRegions = readEnv('IGNORE_REGIONS');
if (ignoreRegions) { try { options.ignoreRegions = JSON.parse(String(ignoreRegions)); } catch (e) {} }
var considerRegions = readEnv('CONSIDER_REGIONS');
if (considerRegions) { try { options.considerRegions = JSON.parse(String(considerRegions)); } catch (e) {} }

var sync = readEnv('SYNC');
if (String(sync) === 'true') options.sync = true;

var responsive = readEnv('RESPONSIVE');
if (String(responsive) === 'true') options.responsiveSnapshotCapture = true;

var testCase = readEnv('TEST_CASE');
if (testCase) options.testCase = String(testCase);

var labels = readEnv('LABELS');
if (labels) options.labels = String(labels);

var response = http.post('http://localhost:5339/snapshot', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: snapshotName, options: options })
});

output.percySnapshotStatus = response.ok ? 'uploaded' : 'failed';
output.percySnapshotCode = response.status;

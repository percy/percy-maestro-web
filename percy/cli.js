#!/usr/bin/env node

const { program } = require('commander');
const { MaestroProvider, uploadFromOutputDir } = require('./providers/maestroProvider');
const log = require('./util/log');
const pkg = require('../package.json');

program
  .name('percy-maestro')
  .description('Percy SDK for Maestro — capture Percy snapshots from Maestro YAML flows')
  .version(pkg.version);

program
  .command('snapshot <name>')
  .description('Capture an explicit named Percy snapshot (for use from a Maestro runScript step)')
  .option('--device-name <name>', 'Device name (defaults to $MAESTRO_DEVICE_NAME)')
  .option('--orientation <orientation>', 'portrait|landscape')
  .option('--ignore-regions <json>', 'JSON array of ignore regions')
  .action(async (name, opts) => {
    try {
      const provider = new MaestroProvider(opts);
      await provider.snapshot(name, opts);
    } catch (e) {
      log.error(`snapshot failed: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command('upload')
  .description('(Screenshot mode) Scan a Maestro output dir and upload every PNG to Percy. Use for mobile flows or when DOM capture is not needed.')
  .option('-d, --dir <path>', 'Maestro output dir (defaults to ./.maestro/tests/latest)')
  .option('--device-name <name>', 'Device name for all uploaded screenshots')
  .option('--os-name <name>', 'Android|iOS|Web (default: auto-detect via adb/xcrun)')
  .option('--url <url>', 'Page URL for web snapshots (required for Web Percy projects)')
  .action(async (opts) => {
    try {
      await uploadFromOutputDir(opts);
    } catch (e) {
      log.error(`upload failed: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('(Advanced) Start only the Percy capture server — useful if you want to manage percy exec separately. Most users should use `percy-maestro exec` instead.')
  .option('--port <port>', 'Port to listen on (default: 5339)', (v) => Number(v), 5339)
  .action(async (opts) => {
    try {
      const { startServer } = require('./server/captureServer');
      await startServer({ port: opts.port });
      process.on('SIGTERM', () => process.exit(0));
      process.on('SIGINT', () => process.exit(0));
    } catch (e) {
      log.error(`serve failed: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command('exec')
  .description('Run `maestro test` with Percy visual testing. Drop-in replacement for `percy exec` that also starts the DOM-capture server for Maestro web flows.')
  .option('--capture-port <port>', 'Port for the capture server (default: 5339)', (v) => Number(v), 5339)
  .allowUnknownOption()
  .action(async () => {
    const { spawn } = require('child_process');
    const { startServer } = require('./server/captureServer');

    // Find args after `--`; commander strips them, so read from argv
    const sep = process.argv.indexOf('--');
    if (sep === -1 || sep === process.argv.length - 1) {
      log.error('usage: percy-maestro exec -- <command> [args...]');
      process.exit(1);
    }
    const cmdArgs = process.argv.slice(sep + 1);

    let server;
    try {
      server = await startServer({ port: 5339 });
    } catch (e) {
      log.error(`failed to start capture server: ${e.message}`);
      process.exit(1);
    }

    const child = spawn('percy', ['exec', '--', ...cmdArgs], { stdio: 'inherit' });
    const cleanup = (code) => {
      try { server.close(); } catch { /* ignore */ }
      process.exit(code ?? 0);
    };
    child.on('exit', cleanup);
    process.on('SIGTERM', () => { child.kill('SIGTERM'); });
    process.on('SIGINT', () => { child.kill('SIGINT'); });
  });

program.parseAsync(process.argv);

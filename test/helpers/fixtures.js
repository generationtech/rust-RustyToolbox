'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Creates a throwaway server folder in the OS temp dir with a config file, a Steam app
// manifest and a start_server.bat (CRLF, as on Windows). Removed by cleanup().
function makeServerDir(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rustytest-'));
  const manifest = path.join(dir, 'appmanifest_258550.acf');
  const launchfile = 'start_server.bat';
  const config = path.join(dir, 'rustytoolbox-test.json');

  writeManifest(manifest, options.buildid ?? '100', options.branch ?? 'staging');

  const batch = options.batch ?? [
    '@echo off',
    ':start',
    'Server\\RustDedicated.exe -batchmode +server.hostname "Test Server" +server.seed 1234 +server.salt 5678 +server.port 28015',
    'goto start',
  ];
  fs.writeFileSync(path.join(dir, launchfile), batch.join('\r\n'));

  const configJson = {
    manifest,
    launchdir: dir,
    launchfile,
    launchexec: 'Server\\RustDedicated.exe',
    autostart: true,
    autofail: true,
    autoupdate: true,
    timer: 1000,
    timeout: 500,
    unavail: 3,
    failsafe: 2,
    announce: 'Update incoming',
    ticks: 2,
    emupdate: false,
    emunavail: false,
    server: '127.0.0.1:1',          // never used: tests mock consoleapi or use a fake server
    password: 'testpw',
    ...options.config,
  };
  for (const key of options.omit || []) delete configJson[key];
  fs.writeFileSync(config, JSON.stringify(configJson, null, 4));

  return {
    dir,
    manifest,
    launchfile,
    config,
    batchPath: path.join(dir, launchfile),
    readConfig: () => JSON.parse(fs.readFileSync(config, 'utf8')),
    readBatch: () => fs.readFileSync(path.join(dir, launchfile), 'utf8'),
    setBuild: (buildid, branch = options.branch ?? 'staging') => writeManifest(manifest, buildid, branch),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function writeManifest(file, buildid, branch) {
  const text = [
    '"AppState"',
    '{',
    '\t"appid"\t\t"258550"',
    `\t"buildid"\t\t"${buildid}"`,
    '\t"UserConfig"',
    '\t{',
    `\t\t"BetaKey"\t\t"${branch}"`,
    '\t}',
    '}',
    '',
  ].join('\r\n');
  fs.writeFileSync(file, text);
  // Give the file a distinct mtime so checkManifest() sees the change.
  const t = new Date(Date.now() + Math.floor(Math.random() * 100000));
  fs.utimesSync(file, t, t);
}

// Snapshot of the rustynail `rusty` object taken at load, used to reset state between tests.
function makeResetter(rustynail) {
  const snapshot = structuredClone({ ...rustynail.rusty, rcon: { ...rustynail.rusty.rcon } });
  return function reset() {
    const fresh = structuredClone(snapshot);
    for (const key of Object.keys(rustynail.rusty)) {
      if (key !== 'rcon' && !(key in fresh)) delete rustynail.rusty[key];
    }
    for (const key of Object.keys(rustynail.rusty.rcon)) {
      if (!(key in fresh.rcon)) delete rustynail.rusty.rcon[key];
    }
    Object.assign(rustynail.rusty.rcon, fresh.rcon);
    delete fresh.rcon;
    Object.assign(rustynail.rusty, fresh);
  };
}

// Silences console output during a test and returns the captured lines.
function captureConsole(t) {
  const lines = [];
  const record = (...args) => lines.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  return lines;
}

module.exports = { makeServerDir, makeResetter, captureConsole };

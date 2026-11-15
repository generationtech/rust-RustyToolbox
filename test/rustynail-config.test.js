'use strict';
const sandbox = require('./helpers/sandbox');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const rustynail = require('../rustynail/rustynail');
const { knownBug } = require('./helpers/known-bug');
const { makeServerDir, makeResetter, captureConsole } = require('./helpers/fixtures');

const { rusty, program } = rustynail;
const resetRusty = makeResetter(rustynail);
let srv;

beforeEach(() => {
  sandbox.reset();
  resetRusty();
});
afterEach(() => {
  if (srv) srv.cleanup();
  srv = null;
  delete program.forcecfg;
});

// Load a fixture config through checkConfig(), the way the main loop does.
async function load(t, options) {
  srv = makeServerDir(options);
  rusty.config = srv.config;
  rusty.configDate = new Date(0);
  const lines = captureConsole(t);
  await rustynail.checkConfig(srv.config);
  return lines;
}

test('config file values are loaded into rusty and rusty.rcon', async (t) => {
  await load(t, { config: { timer: 1234, server: '127.0.0.1:1', password: 'pw' } });
  assert.strictEqual(rusty.timer, 1234);
  assert.strictEqual(rusty.unavail, 3);
  assert.strictEqual(rusty.launchdir, srv.dir);
  assert.strictEqual(rusty.rcon.server, '127.0.0.1:1');
  assert.strictEqual(rusty.rcon.password, 'pw');
});

test('instance name comes from +server.hostname in the batch file', async (t) => {
  await load(t);
  assert.strictEqual(rusty.instance, 'Test Server');
  assert.strictEqual(rusty.eminstance, 'Test Server: ');
});

test('config is reloaded only when the file mtime changes', async (t) => {
  await load(t, { config: { timer: 1111 } });
  rusty.timer = 9999;
  await rustynail.checkConfig(srv.config);
  assert.strictEqual(rusty.timer, 9999, 'unchanged file should not be re-read');
  rusty.configDate = new Date(0);
  await rustynail.checkConfig(srv.config);
  assert.strictEqual(rusty.timer, 1111);
});

test('a key missing from the config falls back to the command-line value, then the default', async (t) => {
  await load(t, { omit: ['timer', 'announce', 'ticks'] });
  assert.strictEqual(rusty.timer, 60000);        // commander default
  assert.strictEqual(rusty.ticks, 5);
  assert.strictEqual(rusty.announce, 'Update released by Facepunch, server rebooting to update');
});

test('a key missing everywhere becomes null', async (t) => {
  await load(t, { omit: ['launchexec'] });
  assert.strictEqual(rusty.launchexec, null);
});

test('the config file beats command-line values unless --forcecfg is set', async (t) => {
  program.timer = 5000;
  try {
    await load(t, { config: { timer: 1234 } });
    assert.strictEqual(rusty.timer, 1234);
    program.forcecfg = true;
    rusty.configDate = new Date(0);
    await rustynail.checkConfig(srv.config);
    assert.strictEqual(rusty.timer, 5000);
  } finally {
    program.timer = 60000;
  }
});

test('a malformed config file is logged and ignored', async (t) => {
  srv = makeServerDir();
  require('fs').writeFileSync(srv.config, '{ not json');
  rusty.configDate = new Date(0);
  const lines = captureConsole(t);
  await rustynail.checkConfig(srv.config);
  assert.ok(lines.some((l) => /JSON/.test(l)));
});

knownBug('#5', 'a missing config file does not crash checkConfig', async (t) => {
  captureConsole(t);
  await assert.doesNotReject(rustynail.checkConfig('Z:\\no\\such\\rustytoolbox.json'));
});

test('#8: unavail defaults to a positive number when not configured', async (t) => {
  await load(t, { omit: ['unavail', 'failsafe'] });
  assert.ok(rusty.unavail > 0, `unavail is ${rusty.unavail}`);
});

test('#8: failsafe defaults to a positive number when not configured', async (t) => {
  await load(t, { omit: ['unavail', 'failsafe'] });
  assert.ok(rusty.failsafe > 0, `failsafe is ${rusty.failsafe}`);
});

test('#9: an unset password stays an empty string, not null', async (t) => {
  await load(t, { omit: ['password'] });
  assert.strictEqual(rusty.rcon.password, '');
});

test('#9: the string "false" in the config turns an option off', async (t) => {
  await load(t, { config: { emupdate: 'false', emunavail: 'false' } });
  assert.strictEqual(rusty.emupdate, false);
});

test('#9: the strings "true"/"TRUE" turn an option on; real booleans pass through', async (t) => {
  await load(t, { config: { emupdate: 'true', emunavail: 'TRUE', autofail: false, autostart: true } });
  assert.strictEqual(rusty.emupdate, true);
  assert.strictEqual(rusty.emunavail, true);
  assert.strictEqual(rusty.autofail, false);
  assert.strictEqual(rusty.autostart, true);
});

test('#9: non-boolean options keep the strings "true"/"false" as text', async (t) => {
  await load(t, { config: { announce: 'false' } });
  assert.strictEqual(rusty.announce, 'false');
});

test('#9: a command-line false for autostart is respected', async (t) => {
  program.autostart = false;
  try {
    await load(t, { omit: ['autostart'] });
    assert.strictEqual(rusty.autostart, false);
  } finally {
    delete program.autostart;
  }
});

test('#9: a falsy command-line value (ticks 0) is kept instead of falling back to the default', async (t) => {
  program.ticks = 0;
  try {
    await load(t, { omit: ['ticks'] });
    assert.strictEqual(rusty.ticks, 0);
  } finally {
    program.ticks = 5;
  }
});

knownBug('secrets', 'printConfig does not log the RCON or email passwords', async (t) => {
  await load(t, { config: { password: 'RconSecret123', empass: 'MailSecret456' } });
  const lines = captureConsole(t);
  rustynail.printConfig();
  const out = lines.join('\n');
  assert.ok(!out.includes('RconSecret123'), 'RCON password was logged');
  assert.ok(!out.includes('MailSecret456'), 'email password was logged');
});

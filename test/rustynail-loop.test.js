'use strict';
const sandbox = require('./helpers/sandbox');

// Drives rustynail's main loop one tick() at a time. RCON (consoleapi), Steam (branchapi),
// process control (fake exec) and sleeps are all faked.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const rustynail = require('../rustynail/rustynail');
const consoleapi = require('../rustyconsole/consoleapi');
const branchapi = require('../rustybranch/branchapi');
const { knownBug } = require('./helpers/known-bug');
const { makeServerDir, makeResetter, captureConsole } = require('./helpers/fixtures');

const { rusty, states } = rustynail;
const resetRusty = makeResetter(rustynail);
let srv;

beforeEach(() => {
  sandbox.reset();
  resetRusty();
});
afterEach(() => {
  if (srv) srv.cleanup();
  srv = null;
});

// world.online: RCON answers. world.running: wmic finds the launcher. world.steam: Steam buildid
// (or an Error to make the lookup fail).
function setUp(t, options = {}) {
  srv = makeServerDir(options);
  rusty.config = srv.config;
  rusty.configDate = new Date(0);
  const world = { online: true, running: true, steam: '100', rcon: [], sleeps: [] };

  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 11, 10, 10, 30) });   // 2nd Thursday: no seed change
  t.mock.method(consoleapi, 'sendCommand', async (rcon) => {
    world.rcon.push(rcon.command);
    if (!world.online) throw new Error('connect ECONNREFUSED');
    return { result: 'ok', error: null };
  });
  t.mock.method(branchapi, 'getBuildID', async () => {
    if (world.steam instanceof Error) throw world.steam;
    return world.steam;
  });
  t.mock.method(rustynail.sys, 'sleep', async (ms) => { world.sleeps.push(ms); });
  sandbox.setExecHandler((cmd) => (cmd.startsWith('wmic ') ? { stdout: world.running ? '4321  \r\n\r\n' : '\r\n' } : {}));

  world.logs = captureConsole(t);
  world.loop = rustynail.newLoopState();
  world.tick = () => rustynail.tick(world.loop);
  world.starts = () => sandbox.execCalls.filter((c) => c.startsWith('start cmd')).length;
  return world;
}

test('online with the same build: checks status, reads manifest and Steam, does nothing else', async (t) => {
  const w = setUp(t);
  await w.tick();
  assert.deepStrictEqual(w.rcon, ['version']);
  assert.strictEqual(rusty.buildid, '100');
  assert.strictEqual(rusty.branch, 'staging');
  assert.strictEqual(w.loop.steamBuildid, '100');
  assert.strictEqual(rusty.operation, states.RUNNING);
  assert.strictEqual(w.starts(), 0);
});

test('update cycle: announce `ticks` times, send quit, wait for reboot, then resume', async (t) => {
  const w = setUp(t);
  w.steam = '101';

  await w.tick();
  assert.deepStrictEqual(w.rcon, ['version', 'say "Build_ID 101 - Update incoming (2 seconds)"']);
  assert.strictEqual(rusty.operation, states.ANNOUNCE);

  w.rcon.length = 0;
  await w.tick();                                   // ANNOUNCE skips the status check
  assert.deepStrictEqual(w.rcon, ['say "Build_ID 101 - Update incoming (1 seconds)"']);

  w.rcon.length = 0;
  await w.tick();
  assert.deepStrictEqual(w.rcon, ['quit']);
  assert.strictEqual(rusty.operation, states.REBOOT);

  w.rcon.length = 0;
  w.online = false;
  await w.tick();                                   // still rebooting
  assert.deepStrictEqual(w.rcon, ['version']);
  assert.strictEqual(rusty.operation, states.REBOOT);

  w.online = true;
  srv.setBuild('101');
  await w.tick();
  assert.strictEqual(rusty.operation, states.RUNNING);
  assert.strictEqual(rusty.buildid, '101');
  assert.ok(w.logs.some((l) => /Server back online after update/.test(l)));

  w.rcon.length = 0;
  await w.tick();
  assert.deepStrictEqual(w.rcon, ['version']);
  assert.strictEqual(w.starts(), 0);
});

test('autoupdate false: a new build is logged but not acted on', async (t) => {
  const w = setUp(t, { config: { autoupdate: false } });
  w.steam = '101';
  await w.tick();
  assert.deepStrictEqual(w.rcon, ['version']);
  assert.strictEqual(rusty.operation, states.RUNNING);
});

test('offline but running: counts misses, restarts at unavail * failsafe (3 * 2 = 6)', async (t) => {
  const w = setUp(t);
  w.online = false;
  for (let i = 1; i <= 5; i++) {
    await w.tick();
    assert.strictEqual(w.starts(), 0, `no restart after miss ${i}`);
  }
  assert.ok(w.logs.some((l) => /Server not responding \(1 attempt\)/.test(l)));
  assert.ok(w.logs.some((l) => /Server not responding \(5 attempts\)/.test(l)));
  await w.tick();
  assert.strictEqual(w.starts(), 1);
  assert.ok(w.logs.some((l) => /Server fatal unresponsive, killing task/.test(l)));
  assert.strictEqual(w.loop.unavail, 0);
});

test('offline and not running: starts it at once and waits 10 s', async (t) => {
  const w = setUp(t);
  w.online = false;
  w.running = false;
  await w.tick();
  assert.strictEqual(w.starts(), 1);
  assert.deepStrictEqual(w.sleeps, [10000]);
  assert.strictEqual(w.loop.unavail, 0);
});

test('autostart false: a stopped server is not started', async (t) => {
  const w = setUp(t, { config: { autostart: false, autofail: false } });
  w.online = false;
  w.running = false;
  for (let i = 0; i < 8; i++) await w.tick();
  assert.strictEqual(w.starts(), 0);
  assert.strictEqual(w.loop.unavail, 8);
});

test('back online after unavail misses logs "back online" once', async (t) => {
  const w = setUp(t);
  w.online = false;
  for (let i = 0; i < 3; i++) await w.tick();
  w.online = true;
  await w.tick();
  await w.tick();
  assert.strictEqual(w.logs.filter((l) => /back online after being unresponsive/.test(l)).length, 1);
});

test('stuck in REBOOT: restarts after unavail * failsafe misses', async (t) => {
  const w = setUp(t, { config: { ticks: 0 } });
  w.steam = '101';
  await w.tick();                                   // ticks 0: straight to quit
  assert.strictEqual(rusty.operation, states.REBOOT);
  w.online = false;
  for (let i = 0; i < 5; i++) await w.tick();
  assert.strictEqual(w.starts(), 0);
  await w.tick();
  assert.strictEqual(w.starts(), 1);
});

test('#2: a failed Steam lookup is not treated as an update', async (t) => {
  const w = setUp(t);
  w.steam = new Error('steamcmd failed');
  await w.tick();
  await w.tick();
  assert.deepStrictEqual(w.rcon, ['version', 'version']);
  assert.strictEqual(rusty.operation, states.RUNNING);
});

test('#2: an unreadable server manifest (no local buildid) is not treated as an update', async (t) => {
  const w = setUp(t, { config: { manifest: 'Z:\\missing\\appmanifest_258550.acf' } });
  w.steam = '101';
  await w.tick();
  assert.deepStrictEqual(w.rcon, ['version']);
  assert.strictEqual(rusty.operation, states.RUNNING);
});

test('#2: after a good lookup, a later failed lookup keeps the last known Steam buildid', async (t) => {
  const w = setUp(t);
  await w.tick();
  w.steam = new Error('steamcmd failed');
  await w.tick();
  assert.strictEqual(w.loop.steamBuildid, '100');
  assert.strictEqual(rusty.operation, states.RUNNING);
});

test('#8: without unavail/failsafe configured, one missed check does not restart the server', async (t) => {
  const w = setUp(t, { omit: ['unavail', 'failsafe'] });
  w.online = false;
  await w.tick();
  assert.strictEqual(w.starts(), 0);
});

test('#8: without unavail configured, "back online" is not logged on every check', async (t) => {
  const w = setUp(t, { omit: ['unavail', 'failsafe'] });
  await w.tick();
  await w.tick();
  assert.strictEqual(w.logs.filter((l) => /back online after being unresponsive/.test(l)).length, 0);
});

test('RCON hang: a quit that gets no reply still moves on to REBOOT monitoring', async (t) => {
  const w = setUp(t, { config: { ticks: 0 } });
  w.steam = '101';
  t.mock.method(consoleapi, 'sendCommand', async (rcon) => {
    w.rcon.push(rcon.command);
    if (rcon.command === 'quit') throw new Error('RCON connection closed before a reply was received');
    return { result: 'ok', error: null };
  });
  await w.tick();
  assert.strictEqual(rusty.operation, states.REBOOT);
  await w.tick();
  assert.deepStrictEqual(w.rcon, ['version', 'quit', 'version']);
});

test('RCON hang: on a first Thursday the seed still changes when quit gets no reply', async (t) => {
  const w = setUp(t, { config: { ticks: 0, seedDate: new Date(2026, 10, 5).toISOString() } });
  t.mock.timers.setTime(new Date(2026, 11, 3, 10, 30).getTime());   // first Thursday
  w.steam = '101';
  t.mock.method(consoleapi, 'sendCommand', async (rcon) => {
    if (rcon.command === 'quit') throw new Error('RCON connection closed before a reply was received');
    return { result: 'ok', error: null };
  });
  await w.tick();
  // checkSeed runs without being awaited; wait up to 2 s for it to write the config.
  const want = new Date(2026, 11, 3).getTime();
  const savedSeedDate = () => { try { return new Date(srv.readConfig().seedDate).getTime(); } catch { return null; } };
  for (let i = 0; i < 200 && savedSeedDate() !== want; i++) await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(savedSeedDate(), want);
  // Let the rest of checkSeed (batch file, restart) finish before the fixture is removed.
  await new Promise((r) => setTimeout(r, 100));
});

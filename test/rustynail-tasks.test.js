'use strict';
const sandbox = require('./helpers/sandbox');

// Process discovery, kill and launch. Every command goes to the sandbox's fake exec;
// nothing is ever queried, killed or started for real.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const rustynail = require('../rustynail/rustynail');
const { makeServerDir, makeResetter, captureConsole } = require('./helpers/fixtures');

const { rusty } = rustynail;
const resetRusty = makeResetter(rustynail);
let srv;

function configure(extra = {}) {
  srv = srv || makeServerDir();
  Object.assign(rusty, {
    launchdir: srv.dir,
    launchfile: 'start_server.bat',
    launchexec: 'Server\\RustDedicated.exe',
    ...extra,
  });
}

// Fake Windows: wmic lists `world.pids` in real wmic format; taskkill removes the PID (unless
// it is in world.unkillable); start records a launch.
function fakeSystem(pids, options = {}) {
  const world = { pids: pids.map(String), unkillable: (options.unkillable || []).map(String) };
  sandbox.setExecHandler((cmd) => {
    if (cmd.startsWith('wmic ')) {
      if (options.wmicFails) throw Object.assign(new Error('Command failed: wmic'), { code: 1 });
      return { stdout: ['ProcessId  ', ...world.pids.map((p) => `${p}      `), '', ''].join('\r\r\n') };
    }
    const kill = cmd.match(/^taskkill \/t \/f \/pid (\d+)$/);
    if (kill && !world.unkillable.includes(kill[1])) world.pids = world.pids.filter((p) => p !== kill[1]);
    return {};
  });
  return world;
}

const wql = (s) => s.replace(/\\/g, '\\\\');
const commands = (prefix) => sandbox.execCalls.filter((c) => c.startsWith(prefix));

beforeEach((t) => {
  sandbox.reset();
  resetRusty();
  t.mock.method(rustynail.sys, 'sleep', async () => {});
});
afterEach(() => {
  if (srv) srv.cleanup();
  srv = null;
});

// ---- the process query ----

test('findTask(true) queries wmic for cmd.exe running this batch file (exact query)', async () => {
  configure();
  fakeSystem([]);
  await rustynail.findTask(true);
  const dir = wql(srv.dir);
  assert.deepStrictEqual(sandbox.execCalls, [
    `wmic process where "(caption = 'cmd.exe' AND NOT commandline LIKE '%wmic%' AND (commandline LIKE '%cd ${dir} && start_server.bat%' OR commandline LIKE '%${dir}\\\\start_server.bat%'))" get ProcessId`,
  ]);
});

test('findTask() also matches the exact RustDedicated.exe path (exact query)', async () => {
  configure();
  fakeSystem([]);
  await rustynail.findTask();
  const dir = wql(srv.dir);
  assert.deepStrictEqual(sandbox.execCalls, [
    `wmic process where "(caption = 'cmd.exe' AND NOT commandline LIKE '%wmic%' AND (commandline LIKE '%cd ${dir} && start_server.bat%' OR commandline LIKE '%${dir}\\\\start_server.bat%')) OR executablepath = '${dir}\\\\Server\\\\RustDedicated.exe'" get ProcessId`,
  ]);
});

test('findTask ignores a trailing separator on launchdir (same query as without it)', async () => {
  configure();
  fakeSystem([]);
  await rustynail.findTask();
  const withoutSeparator = sandbox.execCalls[0];
  sandbox.execCalls.length = 0;
  rusty.launchdir = srv.dir + path.sep;     // a backslash on Windows; on Linux a backslash is a filename character
  await rustynail.findTask();
  assert.strictEqual(sandbox.execCalls[0], withoutSeparator);
});

test('findTask parses PIDs from real wmic output', async () => {
  configure();
  fakeSystem([1234, 5678]);
  assert.deepStrictEqual(await rustynail.findTask(), ['1234', '5678']);
});

test('checkTask is true when the launcher is running, false when not', async () => {
  configure();
  fakeSystem([1234]);
  assert.strictEqual(await rustynail.checkTask(), true);
  fakeSystem([]);
  assert.strictEqual(await rustynail.checkTask(), false);
});

test('a wmic failure is "unknown" (null), and checkTask then assumes running so no second copy starts', async (t) => {
  configure();
  const lines = captureConsole(t);
  fakeSystem([], { wmicFails: true });
  assert.strictEqual(await rustynail.findTask(true), null);
  assert.strictEqual(await rustynail.checkTask(), true);
  assert.ok(lines.some((l) => /assuming it is/.test(l)));
});

// ---- launch settings that could match the wrong processes are refused ----

const refusals = [
  ['launchdir not set', { launchdir: null }, /launchdir is not set/],
  ['empty launchdir (LIKE %% matches everything)', { launchdir: '' }, /launchdir is not set/],
  ['empty launchfile', { launchfile: '' }, /launchfile is not set/],
  ['blank launchexec', { launchexec: '  ' }, /launchexec is not set/],
  ['launchdir inside RustAdminRelease', { launchdir: 'D:\\games\\x\\RustAdminRelease\\srv' }, /RustAdminRelease/],
  ['launchexec inside RustAdminRelease', { launchexec: 'RustAdminRelease\\RustDedicated.exe' }, /RustAdminRelease/],
  ['a quote in launchdir', { launchdir: "D:\\games\\it's" }, /quote/],
  ['a % wildcard in launchfile', { launchfile: '%.bat' }, /quote, %/],
  ['relative launchdir', { launchdir: 'games\\rust' }, /full path/],
  ['drive root launchdir', { launchdir: 'D:\\' }, /drive root/],
  ['launchfile with a folder', { launchfile: 'sub\\start_server.bat' }, /without a folder/],
  ['launchfile that is not a batch file', { launchfile: 'start_server.exe' }, /\.bat or \.cmd/],
  ['launchexec that is not an exe', { launchexec: 'Server\\RustDedicated' }, /\.exe/],
  ['launchfile missing from launchdir', { launchfile: 'other.bat' }, /was not found/],
];

for (const [name, settings, reason] of refusals) {
  test(`refused without running anything: ${name}`, async (t) => {
    configure(settings);
    const lines = captureConsole(t);
    fakeSystem([4, 1234, 5678]);
    assert.match(String(rustynail.launchConfigProblem()), reason);
    assert.strictEqual(await rustynail.findTask(), null);
    assert.strictEqual(await rustynail.endTask(), false);
    assert.strictEqual(await rustynail.startRust(), false);
    assert.deepStrictEqual(sandbox.execCalls, [], 'no wmic, taskkill or start may run');
    assert.ok(lines.some((l) => /Not starting Rust/.test(l)));
  });
}

test('valid settings from the fixture pass', () => {
  configure();
  assert.strictEqual(rustynail.launchConfigProblem(), null);
});

// ---- #1: killing ----

test('#1: endTask runs taskkill for every PID found, re-checks, and reports success', async (t) => {
  configure();
  captureConsole(t);
  const world = fakeSystem([1234, 5678]);
  assert.strictEqual(await rustynail.endTask(), true);
  assert.deepStrictEqual(commands('taskkill'), ['taskkill /t /f /pid 1234', 'taskkill /t /f /pid 5678']);
  assert.strictEqual(commands('wmic').length, 2, 'one lookup before, one after');
  assert.deepStrictEqual(world.pids, []);
});

test('#1: endTask with nothing running kills nothing and reports success', async () => {
  configure();
  fakeSystem([]);
  assert.strictEqual(await rustynail.endTask(), true);
  assert.deepStrictEqual(commands('taskkill'), []);
});

test('#1: endTask reports failure when a process survives, and startRust then does not launch', async (t) => {
  configure();
  const lines = captureConsole(t);
  fakeSystem([1234, 5678], { unkillable: [5678] });
  assert.strictEqual(await rustynail.endTask(), false);
  assert.ok(lines.some((l) => /still running after kill: 5678/.test(l)));
  sandbox.execCalls.length = 0;
  assert.strictEqual(await rustynail.startRust(), false);
  assert.deepStrictEqual(commands('start'), []);
});

test('#1: endTask never kills RustyNail itself, its console, or system PIDs', async (t) => {
  configure();
  captureConsole(t);
  fakeSystem([0, 4, process.pid, process.ppid, 1234]);
  assert.strictEqual(await rustynail.endTask(), false, 'protected PIDs remain, so not confirmed stopped');
  assert.deepStrictEqual(commands('taskkill'), ['taskkill /t /f /pid 1234']);
});

test('#1: a wmic failure during endTask means nothing is killed or started', async (t) => {
  configure();
  captureConsole(t);
  fakeSystem([1234], { wmicFails: true });
  assert.strictEqual(await rustynail.startRust(), false);
  assert.deepStrictEqual(commands('taskkill'), []);
  assert.deepStrictEqual(commands('start'), []);
});

// ---- starting ----

test('startRust kills the old server, confirms it is gone, then launches the batch file (exact commands)', async (t) => {
  configure();
  captureConsole(t);
  fakeSystem([1234]);
  assert.strictEqual(await rustynail.startRust(), true);
  assert.deepStrictEqual(sandbox.execCalls.map((c) => c.split(' ')[0]), ['wmic', 'taskkill', 'wmic', 'start']);
  assert.strictEqual(sandbox.execCalls.at(-1), `start cmd /c "cd ${srv.dir} && start_server.bat"`);
});

test('startRust with nothing running launches straight away', async (t) => {
  configure();
  captureConsole(t);
  fakeSystem([]);
  assert.strictEqual(await rustynail.startRust(), true);
  assert.deepStrictEqual(sandbox.execCalls.map((c) => c.split(' ')[0]), ['wmic', 'start']);
});

test('restartServer logs when the server was not restarted', async (t) => {
  configure({ launchdir: '' });
  const lines = captureConsole(t);
  fakeSystem([]);
  await rustynail.restartServer();
  assert.ok(lines.includes('Rust server was NOT restarted.'));
});

// ---- instance name ----

test('getInstance reads a quoted +server.hostname', async () => {
  configure();
  assert.strictEqual(await rustynail.getInstance(), 'Test Server');
});

test('getInstance returns null without a launchfile', async () => {
  rusty.launchfile = null;
  assert.strictEqual(await rustynail.getInstance(), null);
});

test('hostname: getInstance reads an unquoted +server.hostname', async () => {
  srv = makeServerDir({ batch: ['Server\\RustDedicated.exe -batchmode +server.hostname CoolGeeks +server.port 28015'] });
  Object.assign(rusty, { launchdir: srv.dir, launchfile: srv.launchfile });
  assert.strictEqual(await rustynail.getInstance(), 'CoolGeeks');
});

test('launch: the server is started detached from RustyNail output (spawn, stdio ignored), not with exec', async (t) => {
  // exec waits until every process holding its output pipe exits; the server's cmd.exe inherited that
  // pipe, so startRust never returned and the main loop stopped after RustyNail started the server.
  configure();
  captureConsole(t);
  fakeSystem([]);
  assert.strictEqual(await rustynail.startRust(), true);
  assert.strictEqual(sandbox.spawnOptions.length, 1);
  const launch = sandbox.spawnOptions[0];
  assert.strictEqual(launch.command, `start cmd /c "cd ${srv.dir} && start_server.bat"`);
  assert.strictEqual(launch.shell, true);
  assert.strictEqual(launch.stdio, 'ignore');
});

test('launch: a failed start is reported and startRust returns false', async (t) => {
  configure();
  const lines = captureConsole(t);
  sandbox.setExecHandler((cmd) => {
    if (cmd.startsWith('start ')) throw new Error('start failed');
    return { stdout: '' };
  });
  assert.strictEqual(await rustynail.startRust(), false);
  assert.ok(lines.some((l) => /Failed to start Rust/.test(l)));
});

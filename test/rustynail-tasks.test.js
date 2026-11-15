'use strict';
const sandbox = require('./helpers/sandbox');

// Process discovery, kill and launch. Every command goes to the sandbox's fake exec;
// nothing is ever queried, killed or started for real.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const rustynail = require('../rustynail/rustynail');
const { knownBug } = require('./helpers/known-bug');
const { makeServerDir, makeResetter, captureConsole } = require('./helpers/fixtures');

const { rusty } = rustynail;
const resetRusty = makeResetter(rustynail);

const LAUNCHDIR = 'D:\\games\\example\\rust';
function configure(extra = {}) {
  Object.assign(rusty, {
    launchdir: LAUNCHDIR,
    launchfile: 'start_server.bat',
    launchexec: 'Server\\RustDedicated.exe',
    ...extra,
  });
}

// Fake wmic: returns the given PIDs for process queries; records everything else.
function fakeSystem(pids) {
  sandbox.setExecHandler((cmd) => {
    if (cmd.startsWith('wmic ')) return { stdout: pids.map((p) => `${p}  `).join('\r\n') + '\r\n\r\n' };
    return {};
  });
}

beforeEach(() => {
  sandbox.reset();
  resetRusty();
});

test('findTask(true) queries wmic for cmd.exe running the batch file (exact query)', async () => {
  configure();
  fakeSystem([]);
  await rustynail.findTask(true);
  const dir = String.raw`D:\\games\\example\\rust`;
  assert.strictEqual(sandbox.execCalls[0],
    `wmic process where "caption LIKE '%cmd.exe%' AND commandline LIKE '%${dir}%' AND commandline LIKE '%start_server.bat%'" get ProcessId 2>nul | MORE +1`);
});

test('findTask() also matches the Rust executable path (exact query)', async () => {
  configure();
  fakeSystem([]);
  await rustynail.findTask();
  const dir = String.raw`D:\\games\\example\\rust`;
  const exe = String.raw`Server\\RustDedicated.exe`;
  assert.strictEqual(sandbox.execCalls[0],
    `wmic process where "(caption LIKE '%cmd.exe%' AND commandline LIKE '%${dir}%' AND commandline LIKE '%start_server.bat%') OR executablepath LIKE '%${dir}\\\\${exe}%'" get ProcessId 2>nul | MORE +1`);
});

test('findTask parses PIDs from wmic output', async () => {
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

test('RISK: a wmic error is reported as "not running" (would start a second copy)', async (t) => {
  configure();
  captureConsole(t);
  sandbox.setExecHandler(() => { throw new Error('wmic is not recognized'); });
  assert.deepStrictEqual(await rustynail.findTask(true), []);
  assert.strictEqual(await rustynail.checkTask(), false);
});

test('findTask throws when launchdir is not set', async () => {
  configure({ launchdir: null });
  fakeSystem([]);
  await assert.rejects(rustynail.findTask(true), TypeError);
});

knownBug('kill-scope', 'findTask refuses an empty launchdir instead of matching every process', async (t) => {
  // Step 5 safety work: LIKE '%%' matches every command line on the box.
  configure({ launchdir: '', launchfile: '', launchexec: '' });
  captureConsole(t);
  fakeSystem([4, 1234, 5678]);
  let pids;
  try { pids = await rustynail.findTask(); } catch { pids = 'REFUSED'; }
  assert.strictEqual(pids, 'REFUSED');
});

knownBug('kill-scope', 'findTask refuses a launchdir inside a RustAdminRelease directory', async (t) => {
  configure({ launchdir: 'D:\\games\\example\\RustAdminRelease' });
  captureConsole(t);
  fakeSystem([1234]);
  let pids;
  try { pids = await rustynail.findTask(); } catch { pids = 'REFUSED'; }
  assert.strictEqual(pids, 'REFUSED');
});

knownBug('#1', 'endTask runs taskkill for every PID found', async (t) => {
  configure();
  captureConsole(t);
  fakeSystem([1234, 5678]);
  await rustynail.endTask();
  const kills = sandbox.execCalls.filter((c) => c.startsWith('taskkill'));
  assert.deepStrictEqual(kills, ['taskkill /t /f /pid 1234', 'taskkill /t /f /pid 5678']);
});

test('endTask currently kills nothing: cp.promises.exec is undefined (bug #1)', async (t) => {
  configure();
  const lines = captureConsole(t);
  fakeSystem([1234]);
  await rustynail.endTask();
  assert.ok(!sandbox.execCalls.some((c) => c.startsWith('taskkill')));
  assert.ok(lines.some((l) => /Error killing process 1234/.test(l)));
});

test('startRust ends tasks then launches the batch file in a new console (exact command)', async (t) => {
  configure();
  captureConsole(t);
  fakeSystem([]);
  await rustynail.startRust();
  assert.strictEqual(sandbox.execCalls.at(-1), `start cmd /c "cd ${LAUNCHDIR} && start_server.bat"`);
  assert.match(sandbox.execCalls[0], /^wmic /);
});

test('getInstance reads a quoted +server.hostname', async () => {
  const srv = makeServerDir();
  try {
    Object.assign(rusty, { launchdir: srv.dir, launchfile: srv.launchfile });
    assert.strictEqual(await rustynail.getInstance(), 'Test Server');
  } finally { srv.cleanup(); }
});

test('getInstance returns null without a launchfile', async () => {
  rusty.launchfile = null;
  assert.strictEqual(await rustynail.getInstance(), null);
});

test('hostname: getInstance reads an unquoted +server.hostname', async () => {
  const srv = makeServerDir({ batch: ['Server\\RustDedicated.exe -batchmode +server.hostname CoolGeeks +server.port 28015'] });
  try {
    Object.assign(rusty, { launchdir: srv.dir, launchfile: srv.launchfile });
    assert.strictEqual(await rustynail.getInstance(), 'CoolGeeks');
  } finally { srv.cleanup(); }
});

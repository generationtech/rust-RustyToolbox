'use strict';
const sandbox = require('./helpers/sandbox');

const { test } = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const util = require('util');
const WebSocket = require('ws');
const { startFakeRcon } = require('./helpers/fake-rcon');

test('child_process.exec is refused unless a handler is installed', async () => {
  sandbox.reset();
  await assert.rejects(util.promisify(cp.exec)('taskkill /f /pid 1'), sandbox.SandboxError);
  assert.deepStrictEqual(sandbox.execCalls, ['taskkill /f /pid 1']);
});

test('other child_process functions and process.kill are refused', () => {
  for (const name of ['execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
    assert.throws(() => cp[name]('cmd.exe'), sandbox.SandboxError, name);
  }
  assert.throws(() => process.kill(process.pid), sandbox.SandboxError);
});

test('project modules load the faked exec (rustynail findTask goes through the sandbox)', async (t) => {
  sandbox.reset();
  sandbox.setExecHandler(() => ({ stdout: '' }));
  const rustynail = require('../rustynail/rustynail');
  const srv = require('./helpers/fixtures').makeServerDir();
  t.after(() => srv.cleanup());
  Object.assign(rustynail.rusty, { launchdir: srv.dir, launchfile: srv.launchfile, launchexec: 'Server\\RustDedicated.exe' });
  await rustynail.findTask(true);
  assert.match(sandbox.execCalls[0], /^wmic process where/);
  sandbox.reset();
});

test('network connections to real services are refused', async () => {
  for (const url of ['ws://127.0.0.1:28016/', 'ws://127.0.0.1:28017/', 'ws://127.0.0.1:28047/', 'ws://192.0.2.1:28016/']) {
    const ws = new WebSocket(url);
    const [err] = await new Promise((resolve) => ws.once('error', (e) => resolve([e])));
    assert.match(err.message, /test sandbox\] blocked network connection/, url);
  }
});

test('connections to a registered fake RCON server are allowed', async (t) => {
  const fake = await startFakeRcon();
  t.after(() => fake.close());
  const ws = new WebSocket(`ws://${fake.server}/pw`);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.close();
});

test('runNode can run node itself', async () => {
  const r = await sandbox.runNode(['-e', 'console.log(40 + 2)']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout.trim(), '42');
});

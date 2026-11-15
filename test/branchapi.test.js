'use strict';
const sandbox = require('./helpers/sandbox');

// steamcmd never runs: the sandbox's exec handler returns canned steamcmd output.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const branchapi = require('../rustybranch/branchapi');
const { captureConsole } = require('./helpers/fixtures');

const appInfo = [
  'Redirecting stderr to steam/logs/stderr.txt',
  'Loading Steam API...OK',
  'AppID : 258550, change number : 1/0, last change : Thu Nov 13 2026',
  '"258550"',
  '{',
  '\t"common"',
  '\t{',
  '\t\t"name"\t\t"Rust Dedicated Server"',
  '\t}',
  '\t"depots"',
  '\t{',
  '\t\t"branches"',
  '\t\t{',
  '\t\t\t"public"',
  '\t\t\t{',
  '\t\t\t\t"buildid"\t\t"123"',
  '\t\t\t}',
  '\t\t\t"staging"',
  '\t\t\t{',
  '\t\t\t\t"buildid"\t\t"456"',
  '\t\t\t}',
  '\t\t}',
  '\t}',
  '}',
  'steamcmd has been disconnected',
  '',
].join('\r\n');

function steamcmdReturns(stdout) {
  sandbox.setExecHandler((cmd) => (cmd.startsWith('del ') ? {} : { stdout }));
}

beforeEach(() => sandbox.reset());

test('returns the buildid of the requested branch', async () => {
  steamcmdReturns(appInfo);
  assert.strictEqual(await branchapi.getBuildID('258550', 'staging'), '456');
  assert.strictEqual(await branchapi.getBuildID('258550', 'public'), '123');
});

test('runs del and steamcmd relative to the current directory (exact commands)', async () => {
  steamcmdReturns(appInfo);
  await branchapi.getBuildID('258550', 'public');
  assert.deepStrictEqual(sandbox.execCalls, [
    'del steam\\appcache\\appinfo.vdf',
    'steam\\steamcmd +login anonymous +app_info_update +app_info_print "258550" +logoff +quit',
  ]);
});

test('a failing del is logged and ignored', async (t) => {
  captureConsole(t);
  sandbox.setExecHandler((cmd) => {
    if (cmd.startsWith('del ')) throw new Error('file not found');
    return { stdout: appInfo };
  });
  assert.strictEqual(await branchapi.getBuildID('258550', 'public'), '123');
});

test('throws when steamcmd output has no app info', async (t) => {
  captureConsole(t);
  steamcmdReturns('Loading Steam API...FAILED\r\n');
  await assert.rejects(branchapi.getBuildID('258550', 'public'), /Failed to find app information/);
});

test('throws when the branch does not exist', async (t) => {
  captureConsole(t);
  steamcmdReturns(appInfo);
  await assert.rejects(branchapi.getBuildID('258550', 'nosuchbranch'), /Build ID not found/);
});

// A steamcmd that never answers until the test lets it finish.
function steamcmdHangs() {
  let finish;
  const stalled = new Promise((resolve) => { finish = () => resolve({ stdout: appInfo }); });
  sandbox.setExecHandler((cmd) => (cmd.startsWith('del ') ? {} : stalled));
  // Let it exit, then give branchapi a turn of the event loop to notice.
  return async () => { finish(); await stalled; await new Promise((r) => setImmediate(r)); };
}
const steamcmdRuns = () => sandbox.execCalls.filter((c) => c.startsWith('steam\\steamcmd')).length;

test('a stalled steamcmd gives up after the timeout instead of waiting forever', async (t) => {
  captureConsole(t);
  const finish = steamcmdHangs();
  t.after(finish);
  const started = Date.now();
  await assert.rejects(branchapi.getBuildID('258550', 'public', 50), /steamcmd gave no answer within 0.05 s/);
  assert.ok(Date.now() - started < 2000);
});

test('no second steamcmd starts while a stalled one is still running', async (t) => {
  captureConsole(t);
  const finish = steamcmdHangs();
  await assert.rejects(branchapi.getBuildID('258550', 'public', 50), /no answer/);
  await assert.rejects(branchapi.getBuildID('258550', 'public', 50), /previous steamcmd lookup is still running/);
  assert.strictEqual(steamcmdRuns(), 1);

  await finish();                                   // the stalled steamcmd finally exits
  steamcmdReturns(appInfo);
  assert.strictEqual(await branchapi.getBuildID('258550', 'public', 50), '123');
  assert.strictEqual(steamcmdRuns(), 2);
});

test('the default timeout is 5 minutes', async (t) => {
  steamcmdReturns(appInfo);
  const delays = [];
  const realSetTimeout = setTimeout;
  const stub = t.mock.method(globalThis, 'setTimeout', (fn, ms, ...rest) => {
    delays.push(ms);
    return realSetTimeout(fn, ms, ...rest);
  });
  const pending = branchapi.getBuildID('258550', 'public');
  stub.mock.restore();
  assert.strictEqual(await pending, '123');
  assert.ok(delays.includes(5 * 60 * 1000), `setTimeout delays: ${delays}`);
});

test('throws when steamcmd itself fails', async (t) => {
  captureConsole(t);
  sandbox.setExecHandler((cmd) => {
    if (cmd.startsWith('del ')) return {};
    throw new Error('steamcmd is not recognized');
  });
  await assert.rejects(branchapi.getBuildID('258550', 'public'), /steamcmd is not recognized/);
});

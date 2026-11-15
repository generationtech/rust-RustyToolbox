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

test('throws when steamcmd itself fails', async (t) => {
  captureConsole(t);
  sandbox.setExecHandler((cmd) => {
    if (cmd.startsWith('del ')) return {};
    throw new Error('steamcmd is not recognized');
  });
  await assert.rejects(branchapi.getBuildID('258550', 'public'), /steamcmd is not recognized/);
});

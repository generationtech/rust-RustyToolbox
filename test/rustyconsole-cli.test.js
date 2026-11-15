'use strict';
const sandbox = require('./helpers/sandbox');

// Runs the real rustyconsole CLI in a child node process with the sandbox and a fake `ws`
// preloaded, so no network connection is ever made. The fake records the URL and packet.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { knownBug } = require('./helpers/known-bug');

const script = path.join(__dirname, '..', 'rustyconsole', 'rustyconsole.js');
const preloads = ['-r', path.join(__dirname, 'helpers', 'sandbox.js'), '-r', path.join(__dirname, 'helpers', 'fake-ws-preload.js')];

async function runConsole(args) {
  const r = await sandbox.runNode([...preloads, script, ...args]);
  const line = r.stderr.split(/\r?\n/).find((l) => l.startsWith('__FAKEWS__'));
  const ws = line ? JSON.parse(line.slice('__FAKEWS__'.length)) : null;
  return { ...r, ws };
}

test('with no options it connects to 127.0.0.1:28016 with an empty password and prints the reply', async () => {
  const r = await runConsole(['version']);
  assert.strictEqual(r.ws.url, 'ws://127.0.0.1:28016/');
  assert.deepStrictEqual(r.ws.sent, { Identifier: 1, Message: 'version', Name: 'WebRcon' });
  assert.strictEqual(r.stdout.trim(), 'reply-text');
});

test('with no command it prints an error and exits 1 without connecting', async () => {
  const r = await runConsole([]);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /No command entered/);
  assert.strictEqual(r.ws.url, null);
});

test('#3: -s and -p choose the server and password', async () => {
  const r = await runConsole(['-s', '10.0.0.5:28099', '-p', 'secretpw', 'version']);
  assert.strictEqual(r.ws.url, 'ws://10.0.0.5:28099/secretpw');
});

test('#3: -i sets the message Identifier', async () => {
  const r = await runConsole(['-i', '7', 'version']);
  assert.strictEqual(r.ws.sent.Identifier, 7);
});

test('#3: -q suppresses output', async () => {
  const r = await runConsole(['-q', 'version']);
  assert.strictEqual(r.stdout.trim(), '');
});

test('#3: --json prints the whole reply as JSON', async () => {
  const r = await runConsole(['--json', 'version']);
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout.trim()); }, 'stdout should be JSON');
  assert.strictEqual(parsed.Message, 'reply-text');
});

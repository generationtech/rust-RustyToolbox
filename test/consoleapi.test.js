'use strict';
const sandbox = require('./helpers/sandbox');

const { test } = require('node:test');
const assert = require('node:assert');
const consoleapi = require('../rustyconsole/consoleapi');
const { startFakeRcon } = require('./helpers/fake-rcon');
const { knownBug } = require('./helpers/known-bug');
const { captureConsole } = require('./helpers/fixtures');

function rcon(fake, extra = {}) {
  return { server: fake.server, password: 'pw', command: 'version', id: 1, json: null, quiet: null, ...extra };
}

// Resolves to 'TIMEOUT' if the promise hasn't settled within ms.
function within(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))]);
}

test('sends {Identifier, Message, Name} with the password as the URL path and returns the reply', async (t) => {
  const fake = await startFakeRcon({ password: 'pw' });
  t.after(() => fake.close());
  const result = await consoleapi.sendCommand(rcon(fake, { id: 42, command: 'status' }));
  assert.deepStrictEqual(result, { result: 'echo: status', error: null });
  assert.strictEqual(fake.connections[0].password, 'pw');
  assert.deepStrictEqual(fake.received, [{ Identifier: 42, Message: 'status', Name: 'WebRcon' }]);
});

test('an id of 0/null is sent as Identifier -1', async (t) => {
  const fake = await startFakeRcon();
  t.after(() => fake.close());
  await consoleapi.sendCommand(rcon(fake, { id: null }));
  assert.strictEqual(fake.received[0].Identifier, -1);
});

test('a null password is sent as the literal path "null"', async (t) => {
  const fake = await startFakeRcon();
  t.after(() => fake.close());
  await consoleapi.sendCommand(rcon(fake, { password: null }));
  assert.strictEqual(fake.connections[0].url, '/null');
});

test('a connection error rejects', async (t) => {
  captureConsole(t);
  // Port 9 is not registered with the sandbox, so the connection is refused locally.
  await assert.rejects(consoleapi.sendCommand({ server: '127.0.0.1:9', password: 'x', command: 'version', id: 1 }));
});

knownBug('#4', 'returns the reply with the matching Identifier, not an earlier broadcast', async (t) => {
  const fake = await startFakeRcon({ broadcastFirst: 'some unrelated server log line' });
  t.after(() => fake.close());
  const result = await consoleapi.sendCommand(rcon(fake, { command: 'version' }));
  assert.strictEqual(result.result, 'echo: version');
});

knownBug('RCON-hang', 'rejects when the server closes the connection without replying', async (t) => {
  const fake = await startFakeRcon({ closeWithoutReply: true });
  t.after(() => fake.close());
  const outcome = await within(consoleapi.sendCommand(rcon(fake)).then(() => 'RESOLVED', () => 'REJECTED'), 1500);
  assert.strictEqual(outcome, 'REJECTED');
});

knownBug('RCON-hang', 'gives up when the server never replies', async (t) => {
  const fake = await startFakeRcon({ silent: true });
  t.after(() => fake.close());
  const outcome = await within(consoleapi.sendCommand(rcon(fake)).then(() => 'RESOLVED', () => 'REJECTED'), 1500);
  assert.notStrictEqual(outcome, 'TIMEOUT');
});

knownBug('json-buffer', 'json mode returns text, not a Buffer (ws 8 delivers Buffers)', async (t) => {
  const fake = await startFakeRcon();
  t.after(() => fake.close());
  const result = await consoleapi.sendCommand(rcon(fake, { json: true }));
  assert.strictEqual(typeof result.result, 'string');
});

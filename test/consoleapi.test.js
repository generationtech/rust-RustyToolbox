'use strict';
const sandbox = require('./helpers/sandbox');

const { test } = require('node:test');
const assert = require('node:assert');
const consoleapi = require('../rustyconsole/consoleapi');
const { startFakeRcon } = require('./helpers/fake-rcon');
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

test('#4: returns the reply with the matching Identifier, not an earlier broadcast', async (t) => {
  const fake = await startFakeRcon({ broadcastFirst: 'some unrelated server log line' });
  t.after(() => fake.close());
  const result = await consoleapi.sendCommand(rcon(fake, { command: 'version' }));
  assert.strictEqual(result.result, 'echo: version');
});

test('RCON hang: rejects when the server closes the connection without replying', async (t) => {
  const fake = await startFakeRcon({ closeWithoutReply: true });
  t.after(() => fake.close());
  const outcome = await within(consoleapi.sendCommand(rcon(fake)).then(() => 'RESOLVED', () => 'REJECTED'), 1500);
  assert.strictEqual(outcome, 'REJECTED');
});

test('RCON hang: gives up when the server never replies (rcon.timeout)', async (t) => {
  const fake = await startFakeRcon({ silent: true });
  t.after(() => fake.close());
  const started = Date.now();
  await assert.rejects(within(consoleapi.sendCommand(rcon(fake, { timeout: 300 })), 1500), /No RCON reply within 300 ms/);
  assert.ok(Date.now() - started < 1500);
});

test('RCON hang: without rcon.timeout the default wait is 10 seconds', async (t) => {
  const fake = await startFakeRcon({ silent: true });
  t.after(() => fake.close());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = consoleapi.sendCommand(rcon(fake));
  const outcome = pending.then(() => 'RESOLVED', (e) => e.message);
  t.mock.timers.tick(9999);
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(1);
  assert.strictEqual(await outcome, 'No RCON reply within 10000 ms');
});

test('#4: a broadcast with another Identifier that arrives first is ignored, also with --json', async (t) => {
  const fake = await startFakeRcon({ broadcastFirst: 'unrelated log line' });
  t.after(() => fake.close());
  const result = await consoleapi.sendCommand(rcon(fake, { json: true, id: 5 }));
  assert.deepStrictEqual(JSON.parse(result.result), { Message: 'echo: version', Identifier: 5, Type: 'Generic' });
});

test('a slow reply within the timeout is still accepted', async (t) => {
  const fake = await startFakeRcon({ delayMs: 200 });
  t.after(() => fake.close());
  const result = await consoleapi.sendCommand(rcon(fake, { timeout: 2000 }));
  assert.strictEqual(result.result, 'echo: version');
});

test('json: json mode returns text, not a Buffer (ws 8 delivers Buffers)', async (t) => {
  const fake = await startFakeRcon();
  t.after(() => fake.close());
  const result = await consoleapi.sendCommand(rcon(fake, { json: true }));
  assert.strictEqual(typeof result.result, 'string');
});

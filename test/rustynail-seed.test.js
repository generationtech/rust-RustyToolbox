'use strict';
const sandbox = require('./helpers/sandbox');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const rustynail = require('../rustynail/rustynail');
const { knownBug } = require('./helpers/known-bug');
const { makeServerDir, makeResetter, captureConsole } = require('./helpers/fixtures');

const { rusty } = rustynail;
const resetRusty = makeResetter(rustynail);
const onWindows = process.platform === 'win32';
let srv;

beforeEach(() => {
  sandbox.reset();
  resetRusty();
  sandbox.setExecHandler((cmd) => (cmd.startsWith('wmic ') ? { stdout: '\r\n' } : {}));
});
afterEach(() => {
  if (srv) srv.cleanup();
  srv = null;
});

function firstThursdayByBruteForce(year, month) {
  for (let d = 1; d <= 7; d++) {
    if (new Date(year, month, d).getDay() === 4) return d;
  }
}

test('isFirstThursday is true only on the first Thursday of each month, 2024-2028 (bug #10 fixed on development)', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2024, 0, 1, 12) });
  for (let year = 2024; year <= 2028; year++) {
    for (let month = 0; month < 12; month++) {
      const expected = firstThursdayByBruteForce(year, month);
      const days = new Date(year, month + 1, 0).getDate();
      for (let day = 1; day <= days; day++) {
        t.mock.timers.setTime(new Date(year, month, day, 12).getTime());
        assert.strictEqual(rustynail.isFirstThursday(), day === expected, `${year}-${month + 1}-${day}`);
      }
    }
  }
});

test('replaceEntry replaces an existing value', () => {
  assert.strictEqual(rustynail.replaceEntry('x.exe +server.seed 1 +server.salt 2', 'server.seed', 99), 'x.exe +server.seed 99 +server.salt 2');
});

test('replaceEntry appends a missing entry', () => {
  assert.strictEqual(rustynail.replaceEntry('x.exe -batchmode', 'server.salt', 7), 'x.exe -batchmode +server.salt 7');
});

test('getRandomInt stays in [min, max)', () => {
  for (let i = 0; i < 1000; i++) {
    const n = rustynail.getRandomInt(0, 10);
    assert.ok(n >= 0 && n < 10 && Number.isInteger(n));
  }
});

function setUpSeed(t, seedDate) {
  srv = makeServerDir();
  Object.assign(rusty, {
    config: srv.config,
    launchdir: srv.dir,
    launchfile: srv.launchfile,
    launchexec: 'Server\\RustDedicated.exe',
    seedDate,
    emupdate: false,
  });
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 11, 3, 10, 30) });   // Thu 3 Dec 2026
  return captureConsole(t);
}

test('checkSeed with a Date seedDate before today saves today as seedDate and writes a new seed', async (t) => {
  setUpSeed(t, new Date(2026, 10, 5));
  await rustynail.checkSeed();
  assert.strictEqual(new Date(srv.readConfig().seedDate).getTime(), new Date(2026, 11, 3).getTime());
  if (onWindows) {
    const line = srv.readBatch().split('\r\n').find((l) => l.includes('RustDedicated.exe'));
    assert.doesNotMatch(line, /\+server\.seed 1234\b/);
    assert.match(line, /\+server\.seed \d+ \+server\.salt \d+/);
    assert.ok(sandbox.execCalls.some((c) => c.startsWith('start cmd /c')), 'server should be restarted');
  }
});

test('checkSeed does nothing when the seed was already changed today', async (t) => {
  setUpSeed(t, new Date(2026, 11, 3));
  const before = srv.readConfig();
  await rustynail.checkSeed();
  assert.deepStrictEqual(srv.readConfig(), before);
  assert.deepStrictEqual(sandbox.execCalls, []);
});

test('#7: checkSeed works when seedDate came from the config file as an ISO string', async (t) => {
  // readWriteConfig stores seedDate as an ISO string and checkConfig reloads it as a string;
  // `string < Date` was always false, so the seed changed only once.
  setUpSeed(t, new Date(2026, 10, 5).toISOString());
  await rustynail.checkSeed();
  assert.strictEqual(new Date(srv.readConfig().seedDate).getTime(), new Date(2026, 11, 3).getTime());
});

test('#7: checkSeed works with the stuck values in the live configs (2024 ISO strings)', async (t) => {
  for (const stuck of ['2024-05-02T05:00:00.000Z', '2024-06-03T05:00:00.000Z']) {
    setUpSeed(t, stuck);
    await rustynail.checkSeed();
    assert.strictEqual(new Date(srv.readConfig().seedDate).getTime(), new Date(2026, 11, 3).getTime(), stuck);
    srv.cleanup();
    t.mock.timers.reset();
  }
});

test('#7: checkSeed works with a numeric seedDate (format saved before the 2024 refactor)', async (t) => {
  setUpSeed(t, new Date(2026, 10, 5).getTime());
  await rustynail.checkSeed();
  assert.strictEqual(new Date(srv.readConfig().seedDate).getTime(), new Date(2026, 11, 3).getTime());
});

test('#7: checkSeed does nothing when the ISO-string seedDate is today', async (t) => {
  setUpSeed(t, new Date(2026, 11, 3).toISOString());
  const before = srv.readConfig();
  await rustynail.checkSeed();
  assert.deepStrictEqual(srv.readConfig(), before);
});

test('#7: the seed changes again on the next first Thursday after a reload from the config file', async (t) => {
  setUpSeed(t, new Date(2026, 10, 5));
  await rustynail.checkSeed();                                   // Thu 3 Dec 2026
  rusty.seedDate = srv.readConfig().seedDate;                    // as checkConfig would reload it
  t.mock.timers.setTime(new Date(2027, 0, 7, 10, 30).getTime()); // Thu 7 Jan 2027
  await rustynail.checkSeed();
  assert.strictEqual(new Date(srv.readConfig().seedDate).getTime(), new Date(2027, 0, 7).getTime());
});

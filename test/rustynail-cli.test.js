'use strict';
const sandbox = require('./helpers/sandbox');

// Command-line parsing for rustynail. commander 2 keeps state on a singleton, so these
// tests run in order and each one only adds options.

const { test } = require('node:test');
const assert = require('node:assert');
const rustynail = require('../rustynail/rustynail');
const { knownBug } = require('./helpers/known-bug');

const { rusty, program } = rustynail;

test('#6: every option has a unique short flag (-f is used by --failsafe and --forcecfg)', () => {
  const shorts = program.options.map((o) => o.short).filter(Boolean);
  const dupes = shorts.filter((s, i) => shorts.indexOf(s) !== i);
  assert.deepStrictEqual(dupes, []);
});

test('#5: without -c the config path is the default rustytoolbox.json', () => {
  rustynail.applyCliOptions(['node', 'rustynail.js']);
  assert.strictEqual(rusty.config, 'rustytoolbox.json');
});

test('-c and value options are copied onto rusty (values stay strings)', () => {
  rustynail.applyCliOptions(['node', 'rustynail.js', '-c', 'my.json', '-t', '5000', '-d', 'D:\\srv', '-l', 'go.bat']);
  assert.strictEqual(rusty.config, 'my.json');
  assert.strictEqual(rusty.timer, '5000');
  assert.strictEqual(rusty.launchdir, 'D:\\srv');
  assert.strictEqual(rusty.launchfile, 'go.bat');
});

test('-f sets failsafe and does not touch forcecfg', () => {
  rustynail.applyCliOptions(['node', 'rustynail.js', '-f', '3']);
  assert.strictEqual(rusty.failsafe, '3');
  assert.strictEqual(program.forcecfg, undefined);
});

test('#6: --forcecfg still works as a long option', () => {
  rustynail.applyCliOptions(['node', 'rustynail.js', '--forcecfg']);
  assert.strictEqual(program.forcecfg, true);
  delete program.forcecfg;
});

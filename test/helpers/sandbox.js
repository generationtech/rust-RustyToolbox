'use strict';

// Test safety sandbox. Every test file must require this FIRST, before any project module.
//
// This repo is developed on a live production server. Tests must never kill a process,
// launch a program (cmd, steamcmd, wmic, taskkill), or open a network connection to a
// real service (Rust RCON, SMTP, Steam). This module enforces that by:
//   - replacing child_process functions with fakes that record each call and, by default,
//     refuse it (a test opts in by installing an exec handler that returns canned output);
//   - refusing process.kill;
//   - refusing every outgoing TCP connection except to loopback ports that a test fake
//     registered with allowPort().
// The original spawn function is kept only for runNode(), which runs node itself.

const cp = require('child_process');
const net = require('net');
const util = require('util');

if (global.__rustySandbox) {
  module.exports = global.__rustySandbox;
  return;
}

const original = {
  execFile: cp.execFile,
};

const execCalls = [];
let execHandler = null;
const allowedPorts = new Set();

class SandboxError extends Error {
  constructor(message) {
    super(`[test sandbox] ${message}`);
    this.name = 'SandboxError';
  }
}

async function runExecHandler(command) {
  execCalls.push(command);
  if (!execHandler) {
    throw new SandboxError(`blocked command: ${command}`);
  }
  const result = await execHandler(command);
  return { stdout: '', stderr: '', ...(result || {}) };
}

function fakeExec(command, options, callback) {
  if (typeof options === 'function') callback = options;
  runExecHandler(command).then(
    (r) => callback && callback(null, r.stdout, r.stderr),
    (e) => callback && callback(e, '', '')
  );
  return { pid: undefined, kill() {}, on() { return this; } };
}
fakeExec[util.promisify.custom] = runExecHandler;

function blocked(name) {
  return function () {
    throw new SandboxError(`blocked child_process.${name}(${JSON.stringify(arguments[0])})`);
  };
}

cp.exec = fakeExec;
for (const name of ['execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
  cp[name] = blocked(name);
}

process.kill = function (pid) {
  throw new SandboxError(`blocked process.kill(${pid})`);
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let opts = args[0];
  if (Array.isArray(opts)) opts = opts[0];                       // net's internal normalized form
  if (typeof opts !== 'object' || opts === null) {
    opts = { port: args[0], host: typeof args[1] === 'string' ? args[1] : undefined };
  }
  const host = opts.host || 'localhost';
  const port = Number(opts.port);
  if (opts.path || !LOOPBACK.has(host) || !allowedPorts.has(port)) {
    const where = opts.path ? `pipe ${opts.path}` : `${host}:${opts.port}`;
    const err = new SandboxError(`blocked network connection to ${where}`);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return originalConnect.apply(this, args);
};

const sandbox = {
  SandboxError,
  execCalls,
  setExecHandler(fn) { execHandler = fn; },
  reset() { execCalls.length = 0; execHandler = null; },
  allowPort(port) { allowedPorts.add(Number(port)); },
  disallowPort(port) { allowedPorts.delete(Number(port)); },
  // Run `node <args>` (the only real child process tests may start).
  runNode(args, options = {}) {
    return new Promise((resolve) => {
      original.execFile(process.execPath, args, { timeout: 15000, ...options }, (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
      });
    });
  },
};

global.__rustySandbox = sandbox;
module.exports = sandbox;

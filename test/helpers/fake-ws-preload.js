'use strict';

// Preload for CLI subprocess tests (node -r sandbox.js -r fake-ws-preload.js <script>).
// Replaces the `ws` module with a fake WebSocket that never opens a network connection.
// It records the URL and the packet sent, replies with a canned message, and prints the
// record to stderr on exit as:  __FAKEWS__{"url":...,"sent":...}

const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

const repoRoot = path.resolve(__dirname, '..', '..');
const wsPath = require.resolve('ws', { paths: [repoRoot] });
const report = { url: null, sent: null };

class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    report.url = url;
    setImmediate(() => this.emit('open'));
  }
  send(data) {
    report.sent = JSON.parse(data);
    const reply = { Message: 'reply-text', Identifier: report.sent.Identifier, Type: 'Generic' };
    setImmediate(() => this.emit('message', Buffer.from(JSON.stringify(reply)), false));
  }
  close() {}
}

const fake = new Module(wsPath);
fake.filename = wsPath;
fake.loaded = true;
fake.exports = FakeWebSocket;
require.cache[wsPath] = fake;

process.on('exit', () => {
  process.stderr.write(`__FAKEWS__${JSON.stringify(report)}\n`);
});

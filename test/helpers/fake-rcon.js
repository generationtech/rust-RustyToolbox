'use strict';

// Fake Rust WebRCON server for tests, listening on a random loopback port.
//   - The password is the URL path (ws://host:port/<password>), as in Rust.
//   - Accepts {Identifier, Message, Name} and replies {Message, Identifier, Type}.
// Options:
//   password           if set, connections with a different password are closed
//   reply(message)     returns the reply text (default: "echo: <message>")
//   broadcastFirst     text of an unsolicited broadcast (Identifier 0) sent before the reply
//   delayMs            wait before replying
//   closeWithoutReply  close the connection instead of replying
//   silent             keep the connection open and never reply

const { once } = require('events');
const { WebSocketServer } = require('ws');
const sandbox = require('./sandbox');

async function startFakeRcon(options = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(wss, 'listening');
  const { port } = wss.address();
  sandbox.allowPort(port);

  const connections = [];
  const received = [];

  wss.on('connection', (ws, req) => {
    const password = decodeURIComponent((req.url || '/').slice(1));
    connections.push({ url: req.url, password });
    if (options.password !== undefined && password !== options.password) {
      ws.close();
      return;
    }
    ws.on('message', async (raw) => {
      const packet = JSON.parse(raw.toString());
      received.push(packet);
      if (options.silent) return;
      if (options.closeWithoutReply) {
        ws.close();
        return;
      }
      if (options.broadcastFirst !== undefined) {
        ws.send(JSON.stringify({ Message: options.broadcastFirst, Identifier: 0, Type: 'Generic' }));
      }
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      const message = options.reply ? options.reply(packet.Message) : `echo: ${packet.Message}`;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ Message: message, Identifier: packet.Identifier, Type: 'Generic' }));
      }
    });
  });

  return {
    port,
    server: `127.0.0.1:${port}`,
    connections,
    received,
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      sandbox.disallowPort(port);
    },
  };
}

module.exports = { startFakeRcon };

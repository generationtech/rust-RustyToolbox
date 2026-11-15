const WebSocket = require('ws');

// Longest wait for a reply before giving up, unless rconService.timeout says otherwise.
const DEFAULT_TIMEOUT_MS = 10000;

module.exports.sendCommand = function(rconService) {
  return new Promise((resolve, reject) => {
    const identifier = rconService.id || -1;
    const timeoutMs = Number(rconService.timeout) > 0 ? Number(rconService.timeout) : DEFAULT_TIMEOUT_MS;
    const socket = new WebSocket(`ws://${rconService.server}/${rconService.password}`);
    let settled = false;

    // Settle once, then close the socket and stop the timer.
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error(`No RCON reply within ${timeoutMs} ms`));
    }, timeoutMs);

    socket.on('message', (data) => {
      // Rust also broadcasts console output on this socket; only accept the reply to our Identifier.
      const text = data.toString();
      let packet;
      try {
        packet = JSON.parse(text);
      } catch (e) {
        return;
      }
      if (Number(packet.Identifier) !== Number(identifier)) return;
      const response = rconService.json ? text : packet.Message;
      finish(null, { result: response, error: null });
    });

    socket.on('open', () => {
      const packet = {
        Identifier: identifier,
        Message: rconService.command,
        Name: "WebRcon",
      };
      socket.send(JSON.stringify(packet));
    });

    socket.on('error', (e) => {
      console.error(e.message); // Log error message
      finish(new Error(e.message));
    });

    socket.on('close', () => {
      finish(new Error('RCON connection closed before a reply was received'));
    });

    rconService.disconnect = () => {
      if (socket) socket.close();
    };
  });
};

const WebSocket = require('ws');

module.exports.sendCommand = function(rconService) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${rconService.server}/${rconService.password}`);

    socket.on('message', (data) => {
      rconService.disconnect();
      const response = rconService.json ? data : JSON.parse(data).Message;
      resolve({ result: response, error: null });
    });

    socket.on('open', () => {
      const packet = {
        Identifier: rconService.id || -1,
        Message: rconService.command,
        Name: "WebRcon",
      };
      socket.send(JSON.stringify(packet));
    });

    socket.on('error', (e) => {
      console.error(e.message); // Log error message
      rconService.disconnect();
      reject(new Error(e.message));
    });

    rconService.disconnect = () => {
      if (socket) socket.close();
    };
  });
};

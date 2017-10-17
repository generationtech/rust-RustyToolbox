const webSocket = require('ws');
const util = require('util');

var socket = null;

module.exports.sendCommand = function(rconService) {
  return new Promise(function(resolve, reject) {
    rconService.Disconnect = function() {
      if (socket) {
        socket.close();
        socket = null;
      }
    }

    rconService.SendMessage = function(msg, identifier) {
      if (socket === null || !socket.readyState === 1)
        return;

      if (identifier === null)
        identifier = -1;

      var packet = {
        Identifier: identifier,
        Message: msg,
        Name: "WebRcon"
      };

      socket.send(JSON.stringify(packet));
    };

    socket = new webSocket("ws://" + rconService.server + "/" + rconService.password);

    socket.onmessage = function(e) {
      let retval = null;
      if (!rconService.quiet) {
        if (rconService.json) {
          retval = e.data;
        } else {
          retval = JSON.parse(e.data).Message;
        }
      }
      rconService.Disconnect();
      resolve({ 'result': retval, 'error': null });
    }

    socket.onopen = function() {
      rconService.SendMessage(rconService.command, rconService.id);
    }

    socket.onerror  = function(e) {
      if (!rconService.quiet) console.log(e.message);
      resolve({ 'result': null, 'error': true });
    }
  })
}

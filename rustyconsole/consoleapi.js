const webSocket = require('ws');
const util = require('util');

module.exports.sendCommand = function(rconService) {
  return new Promise(function(resolve, reject) {
    rconService.Disconnect = function() {
      if (rconService.socket) {
        rconService.socket.close();
        rconService.socket = null;
      }
    }

    rconService.SendMessage = function(msg, identifier) {
      if (rconService.socket === null || !rconService.socket.readyState === 1)
        return;

      if (identifier === null)
        identifier = -1;

      var packet = {
        Identifier: identifier,
        Message: msg,
        Name: "WebRcon"
      };

      rconService.socket.send(JSON.stringify(packet));
    };

    rconService.socket = new webSocket("ws://" + rconService.host + "/" + rconService.secret);

    rconService.socket.onmessage = function(e) {
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

    rconService.socket.onopen = function() {
      rconService.SendMessage(rconService.command, rconService.id);
    }

    rconService.socket.onerror  = function(e) {
      if (!rconService.quiet) console.log(e.message);
      resolve({ 'result': null, 'error': true });
    }
  })
}

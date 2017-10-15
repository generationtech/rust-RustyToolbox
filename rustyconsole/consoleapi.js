const WebSocket = require('ws');
const util = require('util');

module.exports.sendCommand = function(rconService) {
  return new Promise(function(resolve, reject) {
    rconService.Disconnect = function() {
      if (rconService.Socket) {
        rconService.Socket.close();
        rconService.Socket = null;
      }
    }

    rconService.SendMessage = function(msg, identifier) {
      if (rconService.Socket === null || !rconService.Socket.readyState === 1)
        return;

      if (identifier === null)
        identifier = -1;

      var packet = {
        Identifier: identifier,
        Message: msg,
        Name: "WebRcon"
      };

      rconService.Socket.send(JSON.stringify(packet));
    };

    rconService.Socket = new WebSocket("ws://" + rconService.Host + "/" + rconService.Secret);

    rconService.Socket.onmessage = function(e) {
      let retval = null;
      if (!rconService.Quiet) {
        if (rconService.JSON) {
          retval = e.data;
        } else {
          retval = JSON.parse(e.data).Message;
        }
      }
      rconService.Disconnect();
      resolve(retval);
    }

    rconService.Socket.onopen = function() {
      rconService.SendMessage(rconService.Command, rconService.Id);
    }

    rconService.Socket.onerror  = function(e) {
       if (!rconService.Quiet) console.log(e.code);
    }
  })
}

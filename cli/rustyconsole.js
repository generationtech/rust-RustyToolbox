#!/usr/bin/env node
'use strict';

var program     = require('commander');
const WebSocket = require('ws');

var defaultIPAddress = `127.0.0.1`;
var defaultPort      = `28016`;
var defaultSecret    = ``;

var rconHost         = null;
var rconSecret       = null;
var rconCommand      = null;

program
  .version('0.1.0')
  .usage('[options] "RCON command sent to Rust server"')
  .arguments('<cmd>')
  .option('-h, --host [optional]',   `host IP address:port, default ${defaultIPAddress}:${defaultPort}`)
  .option('-s, --secret [optional]', 'host password, default blank password')
  .action(function(cmd) {
      rconCommand = cmd;
  })
  .parse(process.argv);

if (!rconCommand || rconCommand == "``") {
  console.log(`No command entered for remote server`);
  program.outputHelp();
  process.exit(1);
} else {
  rconHost    = program.host   ? program.host   : `${defaultIPAddress}:${defaultPort}`;
  rconSecret  = program.secret ? program.secret : ``;
}

var rconService = { Socket: null };

rconService.Disconnect = function() {
  if (rconService.Socket) {
    rconService.Socket.close();
    rconService.Socket = null;
  }
}

rconService.Command = function(msg, identifier) {
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

rconService.Socket = new WebSocket("ws://" + rconHost + "/" + rconSecret);

rconService.Socket.onmessage = function(e) {
  console.log(e.data);
  rconService.Disconnect();
}

rconService.Socket.onopen = function() {
  rconService.Command(rconCommand, 1);
  return;
}

rconService.Socket.onerror  = function(ev) {
   console.log("OnConnectionError", ev);
 }

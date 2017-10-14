#!/usr/bin/env node
'use strict';

var   program   = require('commander');
const WebSocket = require('ws');
const util = require('util');

var defaults = {
      IPAddress: `127.0.0.1`,
      Port:      `28016`,
      Secret:    ``,
    };

var rconService = {
      Socket:  null,
      Host:    null,
      Secret:  null,
      Command: null,
      Id:      1,
      JSON:    null,
      Quiet:   null,
    };

program
  .version('0.2.0')
  .usage('[options] "RCON command sent to Rust server"')
  .arguments('<cmd>')
  .option('-s, --server <host:port>',  `server IP address:port, default ${defaults.IPAddress}:${defaults.Port}`)
  .option('-p, --password <password>', 'server password, defaults to blank password')
  .option('-i, --id <number>',         'message id')
  .option('-j, --json',                'output return data as JSON')
  .option('-q, --quiet',               'suppress output')
  .action(function(cmd) {
      rconService.Command = cmd;
  })
  .parse(process.argv);

if (!rconService.Command || rconService.Command == "``") {
  console.log(`No command entered for remote server`);
  program.outputHelp();
  process.exit(1);
} else {
  rconService.Host   = program.server   ? program.server   : `${defaults.IPAddress}:${defaults.Port}`;
  rconService.Secret = program.password ? program.password : `${defaults.Port}`;
  rconService.Id     = program.id       ? program.id       : rconService.Id;
  rconService.JSON   = program.json     ? program.json     : null;
  rconService.Quiet  = program.quiet    ? program.quiet    : null;
}

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
  if (!rconService.Quiet) {
    if (rconService.JSON) {
      console.log(e.data);
    } else {
      console.log(JSON.parse(e.data).Message);
    }
  }
  rconService.Disconnect();
}

rconService.Socket.onopen = function() {
  rconService.SendMessage(rconService.Command, rconService.Id);
}

rconService.Socket.onerror  = function(e) {
   if (!rconService.Quiet) console.log(e.code);
}

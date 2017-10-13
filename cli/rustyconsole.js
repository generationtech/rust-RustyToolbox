#!/usr/bin/env node
'use strict';

var program     = require('commander');
const WebSocket = require('ws');
//var RconService = require('./rconService')

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

rconService.OnOpen = function() {
  console.log("OnConnected");
  rconService.Command(rconCommand, 1);
  return;
}

rconService.OnClose = function(ev) {
//  console.log("OnDisconnected", ev);
}

rconService.OnError = function(ev) {
  console.log("OnConnectionError", ev);
}

rconService.OnMessage = function(msg) {
  console.log("OnMessage", msg);
}

rconService.Socket = new WebSocket("ws://" + rconHost + "/" + rconSecret);

rconService.Socket.onmessage = function(e) {
  console.log(e.data);
  rconService.Disconnect();
}

rconService.Socket.onopen = rconService.OnOpen;
rconService.Socket.onclose = rconService.OnClose;

rconService.Disconnect = function() {
  if (rconService.Socket) {
    rconService.Socket.close();
    rconService.Socket = null;
  }
}

rconService.Command = function(msg, identifier) {
  if (rconService.Socket.Socket === null)
    return;

//  if (!this.IsConnected())
  //  return;

  if (identifier === null)
    identifier = -1;

  var packet = {
    Identifier: identifier,
    Message: msg,
    Name: "WebRcon"
  };

  console.log(msg);
  console.log(packet);

  console.log("sending command");
  rconService.Socket.send(JSON.stringify(packet));
};



//rconService.Connect( rconHost, rconSecret );


/*
console.log('Welcome to My Console,');
setTimeout(function() {
    console.log('Blah blah blah blah extra-blah');

}, 3000);
*/
/*while (Connected == false) {
  console.log("sloop");
  setTimeout(function (){
    console.log("loop");
  }, 1000);
}*/
//console.log("next");
//rconService.Command(rconCommand, 1);
//rconService.Disconnect();

#!/usr/bin/env node
'use strict';

var program     = require('commander');
var RconService = require('./rconService')

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

  console.log(`rustyconsole -h ${rconHost} -s ${rconSecret} ${rconCommand}`)
  console.log(rconCommand);
/*
//const [,, ... args] = process.argv
//console.log(`RustConsole ${program.args}`)

var rconHost    = program.host   ? program.host   : `127.0.0.1:28016`;
var rconSecret  = program.secret ? program.secret : ``;
var rconCommand = program.args   ? program.args[0]   : ``;

if (rconCommand == ``) {
  console.log(`No command entered for remote server`);
  program.outputHelp();
  process.exit(1);
}

console.log(`rustyconsole -h ${rconHost} -s ${rconSecret} ${rconCommand}`)
console.log(rconCommand);

var rconService = new RconService();

var Connected = false;
var address = null;

var IsConnected = function() {
  return rconService.IsConnected();
}

rconService.OnOpen = function() {
  Connected = true;
  console.log("OnConnected");
  address = rconService.Address;
  rconService.Command(rconCommand, 1);
  return;
}

rconService.OnClose = function(ev) {
  console.log("OnDisconnected", ev);
}

rconService.OnError = function(ev) {
  console.log("OnConnectionError", ev);
}

rconService.OnMessage = function(msg) {
  console.log("OnMessage", msg);
}


rconService.Connect( rconHost, rconSecret );
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
/*
console.log("next");
//rconService.Command(rconCommand, 1);
//rconService.Disconnect();
*/

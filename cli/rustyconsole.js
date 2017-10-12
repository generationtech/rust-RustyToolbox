#!/usr/bin/env node
'use strict';

var program     = require('commander');
var RconService = require('./rconService')

program
  .version('0.1.0')
  .usage('[options] <RCON command to be sent to Rust server>')
  .option('-h, --host [optional]',   'RCON host IP address:port, defaults to 127.0.0.1:28016')
  .option('-s, --secret [optional]', 'RCON host password, defaults to blank password')
  .parse(process.argv);

//const [,, ... args] = process.argv
//console.log(`RustConsole ${program.args}`)

var rcon_host    = program.host   ? program.host   : `127.0.0.1:28016`;
var rcon_secret  = program.secret ? program.secret : ``;
var rcon_command = program.args   ? program.args   : ``;

if (rcon_command == ``) {
  console.log(`No command entered for remote server`);
  program.outputHelp();
  process.exit(1);
}

console.log(`rustyconsole -h ${rcon_host} -s ${rcon_secret} ${rcon_command}`)

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


rconService.Connect( rcon_host, rcon_secret );
console.log('Welcome to My Console,');
setTimeout(function() {
    console.log('Blah blah blah blah extra-blah');
    rconService.Command(rcon_command, 1);
}, 3000);
/*while (Connected == false) {
  console.log("sloop");
  setTimeout(function (){
    console.log("loop");
  }, 1000);
}*/
console.log("next");
//rconService.Command(rcon_command, 1);
//rconService.Disconnect();

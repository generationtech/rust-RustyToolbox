#!/usr/bin/env node
'use strict';

var program    = require('commander');
var consoleapi = require('./consoleapi');

var defaults = {
      IPAddress: `127.0.0.1`,
      Port:      `28016`,
      Secret:    ``,
    };

var rcon = {
      Socket:  null,
      Host:    null,
      Secret:  null,
      Command: null,
      Id:      1,
      JSON:    null,
      Quiet:   null,
    };

program
  .version('0.3.0')
  .usage('[options] "RCON command sent to Rust server"')
  .arguments('<cmd>')
  .option('-s, --server <host:port>',  `server IP address:port, default ${defaults.IPAddress}:${defaults.Port}`)
  .option('-p, --password <password>', 'server password, defaults to blank password')
  .option('-i, --id <number>',         'message id')
  .option('-j, --json',                'output return data as JSON')
  .option('-q, --quiet',               'suppress output')
  .action(function(cmd) {
      rcon.Command = cmd;
  })
  .parse(process.argv);

if (!rcon.Command || rcon.Command == "``") {
  console.log(`No command entered for remote server`);
  program.outputHelp();
  process.exit(1);
} else {
  rcon.Host   = program.server   ? program.server   : `${defaults.IPAddress}:${defaults.Port}`;
  rcon.Secret = program.password ? program.password : `${defaults.Port}`;
  rcon.Id     = program.id       ? program.id       : rcon.Id;
  rcon.JSON   = program.json     ? program.json     : null;
  rcon.Quiet  = program.quiet    ? program.quiet    : null;
}

(async ()=> {
  try{
    let retval = await consoleapi.sendCommand(rcon);
    if (retval) {
      console.log(retval);
    }
  } catch(e) {
    console.log(e)
  }
})();

#!/usr/bin/env node
'use strict';

var program    = require('commander');
var consoleAPI = require('./consoleapi');

var defaults = {
      server:   `127.0.0.1:28016`,
      password: ``,
    };

var rcon = {
      socket:   null,
      server:   null,
      password: null,
      command:  null,
      id:       1,
      json:     null,
      quiet:    null,
    };

program
  .version('0.3.0')
  .usage('[options] "RCON command sent to Rust server"')
  .arguments('<cmd>')
  .option('-s, --server <host:port>',  `server IP address:port, default ${defaults.server}`)
  .option('-p, --password <password>', 'server password, defaults to blank password')
  .option('-i, --id <number>',         'message id')
  .option('-j, --json',                'output return data as JSON')
  .option('-q, --quiet',               'suppress output')
  .action(function(cmd) {
      rcon.command = cmd;
  })
  .parse(process.argv);

if (!rcon.command || rcon.command == "``") {
  console.log(`No command entered for remote server`);
  program.outputHelp();
  process.exit(1);
} else {
  rcon.server   = program.server   ? program.server   : defaults.server;
  rcon.password = program.password ? program.password : defaults.password;
  rcon.id       = program.id       ? program.id       : rcon.id;
  rcon.json     = program.json     ? program.json     : null;
  rcon.quiet    = program.quiet    ? program.quiet    : null;
}

(async ()=> {
  try{
    let retval = await consoleAPI.sendCommand(rcon);
    if (retval['result']) {
      console.log(retval['result']);
    }
  } catch(e) {
    console.log(e)
  }
})();

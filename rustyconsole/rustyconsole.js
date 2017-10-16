#!/usr/bin/env node
'use strict';

var program    = require('commander');
var consoleAPI = require('./consoleapi');

var defaults = {
      ipAddress: `127.0.0.1`,
      port:      `28016`,
      secret:    ``,
    };

var rcon = {
      socket:  null,
      host:    null,
      secret:  null,
      command: null,
      id:      1,
      json:    null,
      quiet:   null,
    };

program
  .version('0.3.0')
  .usage('[options] "RCON command sent to Rust server"')
  .arguments('<cmd>')
  .option('-s, --server <host:port>',  `server IP address:port, default ${defaults.ipAddress}:${defaults.port}`)
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
  rcon.host   = program.server   ? program.server   : `${defaults.ipAddress}:${defaults.port}`;
  rcon.secret = program.password ? program.password : `${defaults.port}`;
  rcon.id     = program.id       ? program.id       : rcon.id;
  rcon.json   = program.json     ? program.json     : null;
  rcon.quiet  = program.quiet    ? program.quiet    : null;
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

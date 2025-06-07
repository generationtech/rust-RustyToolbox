#!/usr/bin/env node
'use strict';

const program = require('commander');
const consoleAPI = require('./consoleapi');

const defaults = {
  server: '127.0.0.1:28016',
  password: '',
  id: 1,
  json: false,
  quiet: false,
};

let rcon = {
  ...defaults,
  command: null,
};

program
  .version('0.3.0')
  .usage('[options] "RCON command sent to Rust server"')
  .arguments('<cmd>')
  .option(`-s, --server <host:port>`, `server IP address:port, default ${defaults.server}`)
  .option('-p, --password <password>', 'server password')
  .option('-i, --id <number>', 'message id', defaults.id)
  .option('-j, --json', 'output return data as JSON', defaults.json)
  .option('-q, --quiet', 'suppress output', defaults.quiet)
  .action((cmd) => {
    rcon.command = cmd;
  })
  .parse(process.argv);

if (!rcon.command) {
  console.error('No command entered for remote server.');
  program.outputHelp();
  process.exit(1);
}

(async () => {
  try {
    const retval = await consoleAPI.sendCommand(rcon);
    if (retval.result && !rcon.quiet) {
      console.log(retval.result);
    }
  } catch (error) {
    console.error('Error sending RCON command:', error.message);
  }
})();

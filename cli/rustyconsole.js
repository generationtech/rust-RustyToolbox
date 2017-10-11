#!/usr/bin/env node

var program = require('commander');

program
  .version('0.1.0')
  .usage('[options] <RCON command to be sent to Rust server>')
  .option('-h, --host', 'RCON host IP address, defaults to 127.0.0.1')
  .option('-p, --port', 'RCON host port, defaults to 28016')
  .option('-s, --secret', 'RCON host password, defaults to blank password')
  .parse(process.argv);


const [,, ... args] = process.argv
console.log(`Hello ${program.args}`)

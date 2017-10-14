#!/usr/bin/env node
'use strict';

var program   = require('commander');
var branchapi = require('./branchapi');

var appid   = '258550';
var branch  = 'public';

program
  .version('0.3.0')
  .usage('[options]')
  .option('-s, --server',        `fetch dedicated server buildid (default)`)
  .option('-c, --client',        `fetch client application buildid`)
  .option('-b, --branch <name>', 'branch checked, defaults to "public"')
  .parse(process.argv);

if (program.server && program.client) {
  console.log(`Choose server or client to check buildid`);
  program.outputHelp();
  process.exit(1);
} else {
  if (program.client) {
    appid = '252490';
  }
  if (program.branch) {
    branch = program.branch;
  }
}

(async ()=> {
  try{
    let retval = await branchapi.getBuildID(appid, branch);
    console.log(retval);
  } catch(e) {
    console.log(e)
  }
})();

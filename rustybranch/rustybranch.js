#!/usr/bin/env node
'use strict';

var cp      =  require("child_process");
var vdf     = require('vdf');
var program = require('commander');

var appid  = '258550';
var branch = 'public';

program
  .version('0.1.0')
  .usage('[options]')
  .option('-s, --server]',   `fetch dedicated server buildid (default)`)
  .option('-c, --client]',   `fetch client application buildid`)
  .option('-b, --branch [optional]', 'branch checked, defaults to "public"')
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

// steamcmd has problem with stdout and redirection in general where output is truncated.
// Must run app_info_print twice to get full output from full run, then must remove the
// the extra half at the end ourselves
cp.exec('steam\\steamcmd +login anonymous +app_info_print "' + appid + '" +app_info_print "' + appid + '" +quit',
  function(error, data) {
    var dStart = data.search('"' + appid + '"');
    data = data.substring(dStart, data.lastIndexOf('"' + appid + '"') - dStart - 12);
//      console.log(data)
    data = vdf.parse(data)
//      console.log(data)
//      console.log(data['258550'])
    console.log(data[appid]['depots']['branches'][branch]['buildid'])
});

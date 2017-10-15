#!/usr/bin/env node
'use strict';

var fs         = require('fs');
var vdf        = require('vdf');
var program    = require('commander');
var branchapi  = require('../rustybranch/branchapi');
var consoleapi = require('../rustyconsole/consoleapi');

var defaults = {
      appid:        `258550`,
      manifestFile: `appmanifest_258550.acf`,
      manifestDir:  `C:\\Server\\rustds\\steamapps`,
//      timer:        60000,
      timer:        3000,
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

var manifestFile;
var timer;

program
  .version('0.3.0')
  .usage('[options]')
  .option('-s, --server <host:port>' ,  `server IP address:port, default ${defaults.IPAddress}:${defaults.Port}`)
  .option('-p, --password <password>',  `server password, defaults to blank password`)
  .option('-m, --manifest <directory>', `directory containing ${defaults.manifestFile}, defaults to ${defaults.manifestDir}`)
  .option('-t, --timer <directory>',    `check loop timer, defaults to ${defaults.timer}`)
  .parse(process.argv);

manifestFile = program.manifest ? program.manifest + '\\' + defaults.manifestFile : defaults.manifestDir + '\\' + defaults.manifestFile;
timer        = program.timer    ? program.timer : defaults.timer;
rcon.Host    = program.server   ? program.server   : `${defaults.IPAddress}:${defaults.Port}`;
rcon.Secret  = program.password ? program.password : `${defaults.Port}`;

function readManifest(file) {
  return new Promise(function(resolve, reject) {
    var data = '';
    var readStream = fs.createReadStream(file, 'utf8');
    readStream.on('data', function(chunk) {
      data += chunk;
    }).on('end', function() {
      let manifest = vdf.parse(data);
      resolve({ 'buildid': manifest['AppState']['buildid'], 'branch': manifest['AppState']['UserConfig']['betakey'] });
    });
  });
}

var states = {
  STOP:    0,
  RUNNING: 1,
  UPGRADE: 2,
}

var flagState = states.RUNNING;

(async ()=> {
  var rustBuildid;
  var rustBranch;
  var steamBuildid;

  while (flagState != states.STOP) {
      if (flagState == states.RUNNING) {
        try {
          let retval  = await readManifest(manifestFile);
          rustBuildid = retval['buildid'];
          rustBranch  = retval['branch'];
          if (!rustBranch) rustBranch = "public";
          console.log(`Server: ${rustBuildid}`);
        } catch(e) {
          console.log(e)
        }

        try {
          steamBuildid = await branchapi.getBuildID(defaults.appid, rustBranch);
          console.log(`Steam:  ${steamBuildid}`);
        } catch(e) {
          console.log(e)
        }
      }

      if (rustBuildid != steamBuildid) {
        if (flagState == states.RUNNING) {
          flagState = states.UPGRADE;
          rcon.Command = 'version';
          try {
            let retval = await consoleapi.sendCommand(rcon);
            if (retval['result']) {
              console.log('console command returned: ' + retval['result']);
            }
          } catch(e) {
            console.log('console command returned error: ' + e)
          }
        } else if (flagState == states.UPGRADE) {
          rcon.Command = 'version';
          try {
            let retval = await consoleapi.sendCommand(rcon);
//            if (retval['result']) {
//              console.log('console command returned: ' + retval['result']);
//            }
            if (!retval['error']) {
              console.log('server back online');
              flagState = states.RUNNING;
            }
          } catch(e) {
            console.log('console command returned error: ' + e)
          }
        }
      }

      console.log('before wait');
      await new Promise((resolve, reject) => setTimeout(() => resolve(), timer));
      console.log('after wait');

  }
  process.exit(0);
})();

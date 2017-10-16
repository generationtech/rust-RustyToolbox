#!/usr/bin/env node
'use strict';

var fs         = require('fs');
var vdf        = require('vdf');
var program    = require('commander');
var branchapi  = require('../rustybranch/branchapi');
var consoleapi = require('../rustyconsole/consoleapi');

var defaults = {
      appID:        `258550`,
      manifestFile: `appmanifest_258550.acf`,
      manifestDir:  `C:\\Server\\rustds\\steamapps`,
      timer:        60000,
//      timer:        3000,
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

var manifestFile;
var timer;

program
  .version('0.3.0')
  .usage('[options]')
  .option('-s, --server <host:port>' ,  `server IP address:port, default ${defaults.ipAddress}:${defaults.port}`)
  .option('-p, --password <password>',  `server password, defaults to blank password`)
  .option('-m, --manifest <directory>', `directory containing ${defaults.manifestFile}, defaults to ${defaults.manifestDir}`)
  .option('-t, --timer <directory>',    `check loop timer in milliseconds, defaults to ${defaults.timer}`)
  .parse(process.argv);

manifestFile = program.manifest ? program.manifest + '\\' + defaults.manifestFile : defaults.manifestDir + '\\' + defaults.manifestFile;
timer        = program.timer    ? program.timer : defaults.timer;
rcon.host    = program.server   ? program.server   : `${defaults.ipAddress}:${defaults.port}`;
rcon.secret  = program.password ? program.password : `${defaults.port}`;

function readManifest(file) {
  return new Promise(function(resolve, reject) {
    var data = '';
    var readStream = fs.createReadStream(file, 'utf8');
    readStream.on('data', function(chunk) {
      data += chunk;
    }).on('end', function() {
      readStream.close();
      let manifest = vdf.parse(data);
      resolve({ 'buildid': manifest['AppState']['buildid'], 'branch': manifest['AppState']['UserConfig']['betakey'] });
    });
  });
}

var states = {
  STOP:    0,   // shut down rustynail and exit
  BOOT:    1,   // startup operations
  RUNNING: 2,   // normal operation. checking for updates and server availability
  UPGRADE: 3,   // server upgrade need detected and initiated
}

//var flagState = states.BOOT;
var flagState = states.RUNNING;

(async ()=> {
  var rustBuildid;
  var rustBranch;
  var steamBuildid;

  while (flagState != states.STOP) {
/*
    // process is starting, read local config file if available
    if (flagState == states.BOOT) {
      try {
        let retval  = await readConfig(manifestFile);
        flagState = states.RUNNING;
      } catch(e) {
        console.log(e)
      }
    }
*/
    // normal running state, check for updates
    if (flagState == states.RUNNING) {
      try {
        let retval  = await readManifest(manifestFile);
        rustBuildid = retval['buildid'];
        rustBranch  = retval['branch'];
        if (!rustBranch) rustBranch = "public";
      } catch(e) {
        console.log(e)
      }

      try {
        steamBuildid = await branchapi.getBuildID(defaults.appID, rustBranch);
      } catch(e) {
        console.log(e)
      }
      console.log(`Server: ${rustBuildid} Steam: ${steamBuildid}`);
    }

    // check if update is detected
    if (rustBuildid != steamBuildid) {
      if (flagState == states.RUNNING) {
        flagState = states.UPGRADE;
        console.log(`Buildid differs, updating server`);
        rcon.command = 'quit';
        try {
          let retval = await consoleapi.sendCommand(rcon);
    //            if (retval['result']) {
    //              console.log('console command returned: ' + retval['result']);
    //            }
        } catch(e) {
          console.log('console command returned error: ' + e)
        }
      } else if (flagState == states.UPGRADE) {
        rcon.command = 'version';
        try {
          let retval = await consoleapi.sendCommand(rcon);
    //            if (retval['result']) {
    //              console.log('console command returned: ' + retval['result']);
    //            }
          if (!retval['error']) {
            console.log('Server back online after update');
            flagState = states.RUNNING;
          }
        } catch(e) {
          console.log('console command returned error: ' + e)
        }
      }
    }
    // snooze the process a bit
    await new Promise((resolve, reject) => setTimeout(() => resolve(), timer));
  }
  process.exit(0);
})();

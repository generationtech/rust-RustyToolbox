#!/usr/bin/env node
'use strict';

// get external libraries
var fs         = require('fs');
var vdf        = require('vdf');
var program    = require('commander');
var branchapi  = require('../rustybranch/branchapi');
var consoleapi = require('../rustyconsole/consoleapi');

// setup some default values
var defaults = {
      appID:        `258550`,
      manifestFile: `appmanifest_258550.acf`,
      manifestDir:  `C:\\Server\\rustds\\steamapps`,
      timer:        60000,
//      timer:        3000,
      ipAddress:    `127.0.0.1`,
      port:         `28016`,
      secret:       ``,
      configFile:   `rustytoolbox.conf`,
    };

// data used to communicate with the RCON interface
var rconObj = {
      socket:  null,
      host:    null,
      secret:  null,
      command: null,
      id:      1,
      json:    null,
      quiet:   null,
    };

// process operational values
var rusty = {
      rcon:            rconObj,
      manifestFile:    null,
      timer:           null,
      operation:       null,
      configFile:      null,
      configFileDate:  new Date(),
      configFileForce: false,
    };

program
  .version('0.3.0')
  .usage('[options]')
  .option('-c, --config <file>' ,       `path and filename of optional config file`)
  .option('-s, --server <host:port>' ,  `server IP address:port, default ${defaults.ipAddress}:${defaults.port}`)
  .option('-p, --password <password>',  `server password, defaults to blank password`)
  .option('-m, --manifest <directory>', `directory containing ${defaults.manifestFile}, defaults to ${defaults.manifestDir}`)
  .option('-t, --timer <directory>',    `check loop timer in milliseconds, defaults to ${defaults.timer}`)
  .option('-f, --force',                `re-loading of config file overrides command-line options`)
  .parse(process.argv);

rusty.manifestFile    = program.manifest ? program.manifest + '\\' + defaults.manifestFile : defaults.manifestDir + '\\' + defaults.manifestFile;
rusty.timer           = program.timer    ? program.timer      : defaults.timer;
rusty.configFile      = program.config   ? program.config : defaults.configFile;
rusty.configFileForce = program.force    ? true : false;
rusty.rcon.host       = program.server   ? program.server : `${defaults.ipAddress}:${defaults.port}`;
rusty.rcon.secret     = program.password ? program.password : `${defaults.port}`;

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

function checkConfig(file) {
  return new Promise(function(resolve, reject) {

    fs.stat(file, function(error, stats) {
        if (stats.mtime.getTime() != rusty.configFileDate.getTime()) {
          rusty.configFileDate = stats.mtime;
          console.log("they are different");
        } else {
          console.log("they are the same");
        }
        resolve(stats);
    });
/*
      readStream.on('data', function(chunk) {
      data += chunk;
    }).on('end', function() {
      readStream.close();
      let manifest = vdf.parse(data);
      resolve({ 'buildid': manifest['AppState']['buildid'], 'branch': manifest['AppState']['UserConfig']['betakey'] });
    });
    */
  });
}

var states = {
  STOP:    0,   // shut down rustynail and exit
  BOOT:    1,   // startup operations
  RUNNING: 2,   // normal operation. checking for updates and server availability
  UPGRADE: 3,   // server upgrade need detected and initiated
}

//var rusty.operation = states.BOOT;
rusty.operation = states.RUNNING;

console.log(rusty['operation']);
console.log(rusty['manifestFile']);
console.log(rusty['rcon']['id']);

(async ()=> {
  var rustBuildid;
  var rustBranch;
  var steamBuildid;

  while (rusty.operation != states.STOP) {

    // check if we need to read config values from file
    await checkConfig(rusty.configFile);

    // normal running state, check for updates
    if (rusty.operation == states.RUNNING) {
      try {
        let retval  = await readManifest(rusty.manifestFile);
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
      if (rusty.operation == states.RUNNING) {
        rusty.operation = states.UPGRADE;
        console.log(`Buildid differs, updating server`);
        rusty.rcon.command = 'quit';
        try {
          let retval = await consoleapi.sendCommand(rusty.rcon);
    //            if (retval['result']) {
    //              console.log('console command returned: ' + retval['result']);
    //            }
        } catch(e) {
          console.log('console command returned error: ' + e)
        }
      } else if (rusty.operation == states.UPGRADE) {
        rusty.rcon.command = 'version';
        try {
          let retval = await consoleapi.sendCommand(rusty.rcon);
    //            if (retval['result']) {
    //              console.log('console command returned: ' + retval['result']);
    //            }
          if (!retval['error']) {
            console.log('Server back online after update');
            rusty.operation = states.RUNNING;
          }
        } catch(e) {
          console.log('console command returned error: ' + e)
        }
      }
    }
    // snooze the process a bit
    await new Promise((resolve, reject) => setTimeout(() => resolve(), rusty.timer));
  }
  process.exit(0);
})();

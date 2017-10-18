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
      appID:    `258550`,
      manifest: `C:\\Server\\rustds\\steamapps\\appmanifest_258550.acf`,
      timer:    60000,
      server:   `127.0.0.1:28016`,
      password: ``,
      config:   `rustytoolbox.json`,
    };

// data used to communicate with the RCON interface
var rconObj = {
      socket:   null,
      server:   null,
      password: null,
      command:  null,
      id:       1,
      json:     null,
      quiet:    null,
    };

// process operational values
var rusty = {
      rcon:         rconObj,
      manifest:     null,
      manifestDate: new Date(),
      buildid:      null,
      branch:       null,
      timer:        null,
      operation:    null,
      config:       null,
      configDate:  new Date(),
    };

program
  .version('0.4.0')
  .usage('[options]')
  .option('-c, --config <file>' ,      `path and filename of optional config file`)
  .option('-s, --server <host:port>' , `server IP address:port, default ${defaults.server}`)
  .option('-p, --password <password>', `server password, defaults to blank password`)
  .option('-m, --manifest <path>',     `location of manifest file, defaults to ${defaults.manifest}`)
  .option('-t, --timer <directory>',   `check loop timer in milliseconds, defaults to ${defaults.timer}`)
  .option('-f, --forcecfg',            `re-loading of config file overrides command-line options`)
  .parse(process.argv);

rusty.config = program.config ? program.config : defaults.config;

function readManifest(file) {
  return new Promise(function(resolve, reject) {
    try {
      var data = '';
      var readStream = fs.createReadStream(file, 'utf8');
      readStream.on('data', function(chunk) {
        data += chunk;
      }).on('end', function() {
        readStream.close();
      });
      resolve(data);
    } catch(e) {
      console.log(e)
    }
  });
}

function checkManifest(file) {
//  return new Promise(function(resolve, reject) {
    // try not to waste time re-reading rust server manifest after booting
    // rustynail unless the modified date/time changes, which would indicate
    // the server was updated or re-installed outside of script control
    // while script was running
    fs.stat(file, function(error, stats) {
//      console.log(`rusty.manifestDate: ${rusty.manifestDate.getTime()}`);
//      console.log(`stats.mtime: ${stats.mtime.getTime()}`);
      if (stats.mtime.getTime() != rusty.manifestDate.getTime()) {
        try {
          let data     = await readManifest(file);
          let manifest = vdf.parse(data);
          console.log(manifest);
          var branch   = manifest['AppState']['UserConfig']['betakey'] ? manifest['AppState']['UserConfig']['betakey'] : "public";
          var buildid  = manifest['AppState']['buildid'] ? manifest['AppState']['buildid'] : "public";
          rusty.manifestDate = stats.mtime;
//          resolve({ 'buildid': buildid, 'branch': branch });
          return({ 'buildid': buildid, 'branch': branch });
        } catch(e) {
          console.log(e)
        }
      } else {
//        console.log(`buildid resolve2:       ${rusty.buildid}`);
//        console.log(`branch resolve2:        ${rusty.branch}`);
        resolve({ 'buildid': rusty.buildid, 'branch': rusty.branch });
      }
    });
  });
}

function checkConfig(file) {
  return new Promise(function(resolve, reject) {
    fs.stat(file, function(error, stats) {
        if (stats.mtime.getTime() != rusty.configDate.getTime()) {
          try {
            var jsonConfig = JSON.parse(fs.readFileSync(file, 'utf8'));

            setConfig(jsonConfig, rusty, "manifest");
            setConfig(jsonConfig, rusty, "timer");
            setConfig(jsonConfig, rusty.rcon, "server");
            setConfig(jsonConfig, rusty.rcon, "password");

            rusty.configDate = stats.mtime;
            printConfig();
          } catch(e) {
            console.log(e)
          }
        }
        resolve(stats);
    });
  });
}

function setConfig(jsonConfig, rustyVar, configKey) {
  if (jsonConfig.hasOwnProperty(configKey) && !program.forcecfg) {
    rustyVar[configKey] = jsonConfig[configKey];
  } else if (program[configKey]) {
    rustyVar[configKey] = program[configKey];
  } else {
    rustyVar[configKey] = defaults[configKey];
  }
}

function printConfig() {
  console.log(`manifest:      ${rusty.manifest}`);
  console.log(`manifestDate:  ${rusty.manifestDate}`);
  console.log(`buildid:       ${rusty.buildid}`);
  console.log(`branch:        ${rusty.branch}`);
  console.log(`timer:         ${rusty.timer}`);
  console.log(`operation:     ${rusty.operation}`);
  console.log(`config:        ${rusty.config}`);
  console.log(`configDate:    ${rusty.configDate}`);
  console.log(`rcon.socket:   ${rusty.rcon.socket}`);
  console.log(`rcon.server:   ${rusty.rcon.server}`);
  console.log(`rcon.password: ${rusty.rcon.password}`);
  console.log(`rcon.command:  ${rusty.rcon.command}`);
  console.log(`rcon.id:       ${rusty.rcon.id}`);
  console.log(`rcon.json:     ${rusty.rcon.json}`);
  console.log(`rcon.quiet:    ${rusty.rcon.quiet}`);
}

var states = {
  STOP:    0,   // shut down rustynail and exit
  BOOT:    1,   // startup operations
  RUNNING: 2,   // normal operation. checking for updates and server availability
  UPGRADE: 3,   // server upgrade need detected and initiated
}

//var rusty.operation = states.BOOT;
rusty.operation = states.RUNNING;

(async ()=> {
  var rustBuildid;
  var rustBranch;
  var steamBuildid;

  while (rusty.operation != states.STOP) {

    // check if we need to read config values from file
//    await checkConfig(rusty.config);
    checkConfig(rusty.config);

    // normal running state, check for updates
    if (rusty.operation == states.RUNNING) {
      try {
//        await readManifest(rusty.manifest);
//        console.log(`buildid:       ${rusty.buildid}`);
//        console.log(`branch:        ${rusty.branch}`);

        let retval  = await checkManifest(rusty.manifest);
        rustBuildid = retval['buildid'];
        rustBranch  = retval['branch'];
        rusty.buildid = retval['buildid'];
        rusty.branch  = retval['branch'];
//        console.log(`buildid:       ${rusty.buildid}`);
//        console.log(`branch:        ${rusty.branch}`);
//        if (!rustBranch) rustBranch = "public";
      } catch(e) {
        console.log(e)
      }

      try {
        steamBuildid = await branchapi.getBuildID(defaults.appID, rusty.branch);
      } catch(e) {
        console.log(e)
      }
      console.log(`Server: ${rusty.buildid} Steam: ${steamBuildid}`);
    }

    // check if update is detected
    if (rusty.buildid != steamBuildid) {
      if (rusty.operation == states.RUNNING) {
        rusty.operation = states.UPGRADE;
        console.log(`Buildid differs, updating server`);
        rusty.rcon.command = 'quit';
        try {
          let retval = await consoleapi.sendCommand(rusty.rcon);
        } catch(e) {
          console.log('console command returned error: ' + e)
        }
      } else if (rusty.operation == states.UPGRADE) {
        rusty.rcon.command = 'version';
        try {
          let retval = await consoleapi.sendCommand(rusty.rcon);
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

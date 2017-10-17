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
      rcon:       rconObj,
      manifest:   null,
      timer:      null,
      operation:  null,
      config:     null,
      configDate: new Date(),
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
        if (stats.mtime.getTime() != rusty.configDate.getTime()) {
          try {
            var jsonConfig = JSON.parse(fs.readFileSync(file, 'utf8'));

            if (jsonConfig.hasOwnProperty("manifest") && !program.forcecfg) {
              rusty.manifest = jsonConfig.manifest;
            } else if (program.manifest) {
              rusty.manifest = program.manifest;
            } else {
              rusty.manifest = defaults.manifest;
            }

            if (jsonConfig.hasOwnProperty("timer") && !program.forcecfg) {
              rusty.timer = jsonConfig.timer;
            } else if (program.timer) {
              rusty.timer = program.timer;
            } else {
              rusty.timer = defaults.timer;
            }

            if (jsonConfig.hasOwnProperty("server") && !program.forcecfg) {
              rusty.rcon.server = jsonConfig.server;
            } else if (program.server) {
              rusty.rcon.server = program.server;
            } else {
              rusty.rcon.server = defaults.server;
            }

            if (jsonConfig.hasOwnProperty("password") && !program.forcecfg) {
              rusty.rcon.password = jsonConfig.password;
            } else if (program.password) {
              rusty.rcon.password = program.password;
            } else {
              rusty.rcon.password = defaults.password;
            }

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

/*
function setConfig(jsonConfig, rustyKey, configKey) {
//  console.log(`setting: ${rustyKey} ${configKey}`);
  if (jsonConfig.hasOwnProperty(configKey) && !program.forcecfg) {
//    console.log("config file");
    rusty[rustyKey] = jsonConfig[configKey];
  } else if (program[configKey]) {
//    console.log("program option");
    rusty[rustyKey] = program[configKey];
  } else {
//    console.log("defaults");
    rusty[rustyKey] = defaults[configKey];
  }
}
*/

function printConfig() {
  console.log(`manifest:      ${rusty.manifest}`);
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
    await checkConfig(rusty.config);

    // normal running state, check for updates
    if (rusty.operation == states.RUNNING) {
      try {
        let retval  = await readManifest(rusty.manifest);
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

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
      announce:  `Update released by Facepunch, server rebooting to update`,
      ticks: 5,
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
      configDate:   new Date(),
    };

program
  .version('0.4.0')
  .usage('[options]')
  .option('-c, --config <file>' ,      `path and filename of optional config file`)
  .option('-s, --server <host:port>' , `server IP address:port`)
  .option('-p, --password <password>', `server password`)
  .option('-m, --manifest <path>',     `location of manifest file`)
  .option('-t, --timer <directory>',   `check loop timer in milliseconds`)
  .option('-a, --announce <message>',  `pre-upgrade in-game message`)
  .option('-b, --ticks <number>',      `number of times to repeat update message`)
  .option('-f, --forcecfg',            `config file overrides command-line options`)
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
        resolve(data);
      });
    } catch(e) {
      console.log(e)
    }
  });
}

async function checkManifest(file) {
  // try not to waste time re-reading rust server manifest after booting
  // rustynail unless the modified date/time changes, which would indicate
  // the server was updated or re-installed outside of script control
  // while script was running
  try {
    var stats = fs.statSync(file)
    if (stats.mtime.getTime() != rusty.manifestDate.getTime()) {
      try {
        var data      = await readManifest(file);
        let manifest  = vdf.parse(data);
        if (manifest) {
          rusty.branch  = manifest['AppState']['UserConfig']['betakey'] ? manifest['AppState']['UserConfig']['betakey'] : "public";
          rusty.buildid = manifest['AppState']['buildid']               ? manifest['AppState']['buildid']               : rusty.buildid;
          rusty.manifestDate = stats.mtime;
        }
      } catch(e) {
        console.log(e)
      }
    }
  } catch(e) {
    console.log(e)
  }
}

function checkConfig(file) {
  var stats = fs.statSync(file)
  if (stats.mtime.getTime() != rusty.configDate.getTime()) {
    try {
      var jsonConfig = JSON.parse(fs.readFileSync(file, 'utf8'));

      setConfig(jsonConfig, rusty, "manifest");
      setConfig(jsonConfig, rusty, "timer");
      setConfig(jsonConfig, rusty, "announce");
      setConfig(jsonConfig, rusty, "ticks");
      setConfig(jsonConfig, rusty.rcon, "server");
      setConfig(jsonConfig, rusty.rcon, "password");

      rusty.configDate = stats.mtime;
      printConfig();
    } catch(e) {
      console.log(e)
    }
  }
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
  console.log(`config:        ${rusty.config}`);
  console.log(`configDate:    ${rusty.configDate}`);
  console.log(`manifest:      ${rusty.manifest}`);
  console.log(`manifestDate:  ${rusty.manifestDate}`);
  console.log(`timer:         ${rusty.timer}`);
  console.log(`announce:      ${rusty.announce}`);
  console.log(`ticks:         ${rusty.ticks}`);
  console.log(`buildid:       ${rusty.buildid}`);
  console.log(`branch:        ${rusty.branch}`);
  console.log(`operation:     ${rusty.operation}`);
  console.log(`rcon.socket:   ${rusty.rcon.socket}`);
  console.log(`rcon.server:   ${rusty.rcon.server}`);
  console.log(`rcon.password: ${rusty.rcon.password}`);
  console.log(`rcon.command:  ${rusty.rcon.command}`);
  console.log(`rcon.id:       ${rusty.rcon.id}`);
  console.log(`rcon.json:     ${rusty.rcon.json}`);
  console.log(`rcon.quiet:    ${rusty.rcon.quiet}`);
}

var states = {
  STOP:     0,   // shut down rustynail and exit
  BOOT:     1,   // startup operations
  RUNNING:  2,   // normal operation. checking for updates and server availability
  ANNOUNCE: 3,   // server upgrade need detected and announcing
  UPGRADE:  4,   // server upgrade need detected and announced
  REBOOT:   5,   // server upgrade need detected and initiated
}

//var rusty.operation = states.BOOT;
rusty.operation = states.RUNNING;

//
// MAIN
//
(async ()=> {
  var steamBuildid = null;
  var announceTick = 0;

  while (rusty.operation != states.STOP) {

    // check if we need to read config values from file
    checkConfig(rusty.config);

    // normal running state, check for updates
    if (rusty.operation == states.RUNNING) {
      try {
        await checkManifest(rusty.manifest);
      } catch(e) {
        console.log(e)
      }
      try {
        if (rusty.branch) {
          let retval = await branchapi.getBuildID(defaults.appID, rusty.branch);
          if (retval) steamBuildid = retval;
        }
      } catch(e) {
        console.log(e)
      }
      console.log(`Server: ${rusty.buildid} Steam: ${steamBuildid}`);
    }

    // check if update is detected
    if (rusty.buildid != steamBuildid) {

      // new update ready from Facepunch
      if (rusty.operation == states.RUNNING || rusty.operation == states.ANNOUNCE) {
        if (announceTick < rusty.ticks  && rusty.announce) {
          rusty.operation = states.ANNOUNCE;
          console.log(`Buildid differs, announcing update`);
          rusty.rcon.command = 'say "' + rusty.announce + ' (' + (rusty.timer / 1000) * (rusty.ticks - announceTick) + ' seconds)"';
          try {
            let retval = await consoleapi.sendCommand(rusty.rcon);
          } catch(e) {
            console.log('console command returned error: ' + e)
          }
          announceTick++;
        } else {
          announceTick = 0;
          rusty.operation = states.UPGRADE;
        }
      }

      // ready to reboot for upgrade
      else if (rusty.operation == states.UPGRADE) {
        console.log(`Buildid differs, updating server`);
        rusty.rcon.command = 'quit';
        try {
          rusty.operation = states.REBOOT;
          let retval = await consoleapi.sendCommand(rusty.rcon);
        } catch(e) {
          console.log('console command returned error: ' + e)
        }
      }

      // monitor for server to come back online
      else if (rusty.operation == states.REBOOT) {
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

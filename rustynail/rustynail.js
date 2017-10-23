#!/usr/bin/env node
'use strict';

//
//  TBD
//
/*
      Server monitoring:
        -advanced function to kill/restart rust server. can be used during
         startup for initial rust server run

      Change seed on 1st Thursday upgrade
*/

// get external libraries
var fs         = require('fs');
var readline   = require('readline');
var stream     = require('stream');
var vdf        = require('vdf');
var program    = require('commander');
var branchapi  = require('../rustybranch/branchapi');
var consoleapi = require('../rustyconsole/consoleapi');
var nodemailer = require('nodemailer');

// setup some default values
var defaults = {
  appID:    `258550`,
  manifest: `C:\\Server\\rustds\\steamapps\\appmanifest_258550.acf`,
  timer:    60000,
  server:   `127.0.0.1:28016`,
  password: ``,
  config:   `rustytoolbox.json`,
  announce: `Update released by Facepunch, server rebooting to update`,
  ticks:    5,
};

var states = {
  STOP:     0,   // shut down rustynail and exit
  BOOT:     1,   // startup operations
  RUNNING:  2,   // normal operation. checking for updates and server availability
  ANNOUNCE: 3,   // server upgrade need detected and announcing
  UPGRADE:  4,   // server upgrade need detected and announced
  REBOOT:   5,   // server upgrade need detected and initiated
}

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
  emuser:       null,
  empass:       null,
  emupdate:     false,
  emunavail:    false,
  emailUpdate:  null,
  emailUnavail: null,
  launchfile:   null,
  instance:     null,
  eminstance:     null,
  unavail:      10,
};

program
  .version('0.4.0')
  .usage('[options]')
  .option('-c, --config <file>' ,         `path and filename of optional config file`)
  .option('-s, --server <host:port>' ,    `server IP address:port`)
  .option('-p, --password <password>',    `server password`)
  .option('-m, --manifest <path>',        `location of manifest file`)
  .option('-t, --timer <directory>',      `check loop timer in milliseconds`)
  .option('-n, --unavail <number>',       `unavailability ticks`)
  .option('-a, --announce <message>',     `pre-upgrade in-game message`)
  .option('-b, --ticks <number>',         `number of times to repeat update message`)
  .option('-u, --emuser <email address>', `email address for sending email`)
  .option('-v, --empass <password>',      `email user password`)
  .option('-w, --emupdate',               `enable sending email for updates`)
  .option('-x, --emunavail',              `enable sending email for unavailability`)
  .option('-l, --launchfile <path>',      `path and name of batch file to launch Rust`)
  .option('-f, --forcecfg',               `config file overrides command-line options`)
  .parse(process.argv);

rusty.config    = program.config ? program.config : defaults.config;
rusty.operation = states.RUNNING;

//
// MAIN
//
(async ()=> {
  var steamBuildid = null;
  var announceTick = 0;
  var unavail      = 0;


  while (rusty.operation != states.STOP) {

    // check if we need to read config values from file
    checkConfig(rusty.config);

    // normal running state, check for updates
    if (rusty.operation == states.RUNNING) {
      if (await checkStatus()) {
        if (unavail >= rusty.unavail) {
          console.log("Server back online after being unresponsive");
          if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "back online after being unresponsive", rusty.eminstance + "back online after being unresponsive");
        }
        unavail = 0;
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
      } else {
        unavail++;
        console.log("Server not responding (" + unavail + " attempt" + (unavail == 1 ? "" : "s") + ")");
        if (unavail == rusty.unavail) {
          if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "not responding", rusty.eminstance + "not responding");
        }
      }
    }

    // check if update is detected
    if (rusty.buildid != steamBuildid) {

      // new update ready from Facepunch
      if (rusty.operation == states.RUNNING || rusty.operation == states.ANNOUNCE) {
        if (announceTick < rusty.ticks  && rusty.announce) {
          rusty.operation = states.ANNOUNCE;
          console.log(`Buildid ` + rusty.buildid + ` differs ` + steamBuildid + `, announcing update`);
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
      if (rusty.operation == states.UPGRADE) {
        console.log(`Buildid differs, updating server`);
        if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "rebooting for update to buildid " + steamBuildid, rusty.eminstance + "rebooting for update to buildid: " + steamBuildid);
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
        if (await checkStatus()) {
          if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "back online after update", rusty.eminstance + "back online after update");
          console.log('Server back online after update');
          rusty.manifestDate = new Date();
          try {
            await checkManifest(rusty.manifest);
          } catch(e) {
            console.log(e)
          }
          rusty.operation = states.RUNNING;
        }
      }
    }
    // snooze the process a bit
    await new Promise((resolve, reject) => setTimeout(() => resolve(), rusty.timer));
  }
  process.exit(0);
})();

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

async function checkConfig(file) {
  var stats = fs.statSync(file)
  if (stats.mtime.getTime() != rusty.configDate.getTime()) {
    try {
      var jsonConfig = JSON.parse(fs.readFileSync(file, 'utf8'));

      setConfig(jsonConfig, rusty, "manifest");
      setConfig(jsonConfig, rusty, "timer");
      setConfig(jsonConfig, rusty, "announce");
      setConfig(jsonConfig, rusty, "ticks");
      setConfig(jsonConfig, rusty, "emuser");
      setConfig(jsonConfig, rusty, "empass");
      setConfig(jsonConfig, rusty, "emupdate");
      setConfig(jsonConfig, rusty, "emunavail");
      setConfig(jsonConfig, rusty, "emailUpdate");
      setConfig(jsonConfig, rusty, "emailUnavail");
      setConfig(jsonConfig, rusty, "launchfile");
      setConfig(jsonConfig, rusty, "unavail");
      setConfig(jsonConfig, rusty.rcon, "server");
      setConfig(jsonConfig, rusty.rcon, "password");
      rusty.instance = await getInstance();
      rusty.eminstance = rusty.instance ? rusty.instance + ": " : "Server ";

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
  } else if (defaults[configKey]) {
    rustyVar[configKey] = defaults[configKey];
  } else {
    rustyVar[configKey] = null;
  }
}

function printConfig() {
  console.log();
  console.log(`config:        ${rusty.config}`);
  console.log(`configDate:    ${rusty.configDate}`);
  console.log(`manifest:      ${rusty.manifest}`);
  console.log(`manifestDate:  ${rusty.manifestDate}`);
  console.log(`timer:         ${rusty.timer}`);
  console.log(`announce:      ${rusty.announce}`);
  console.log(`ticks:         ${rusty.ticks}`);
  console.log(`emuser:        ${rusty.emuser}`);
  console.log(`empass:        ${rusty.empass}`);
  console.log(`emupdate:      ${rusty.emupdate}`);
  console.log(`emunavail:     ${rusty.emunavail}`);
  console.log(`emailUpdate:   ${rusty.emailUpdate}`);
  console.log(`emailUnavail:  ${rusty.emailUnavail}`);
  console.log(`launchfile:    ${rusty.launchfile}`);
  console.log(`instance:      ${rusty.instance}`);
  console.log(`unavail:       ${rusty.unavail}`);
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
  console.log();
}

function sendEmail(eaddress, esubject, emessage) {
  var transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   465,
    secure: true,
    auth: {
      user: rusty.emuser,
      pass: rusty.empass
    }
  });
  var mailOptions = {
    from:    rusty.emuser,
    to:      eaddress,
    subject: esubject,
    text:    emessage
  };
  transporter.sendMail(mailOptions, function(error, info){
    if (error) {
      console.log(error);
    } else {
      console.log('Emailed: ' + eaddress);
    }
  });
}

function sendEmails(elist, esubject, emessage) {
  elist.forEach(function(element) {
      sendEmail(element, esubject, emessage);
  });
}

async function checkStatus() {
  rusty.rcon.command = 'version';
  var retval;
  try {
    retval = await status();
    return retval;
  } catch(e) {
    console.log('console command returned error: ' + e)
  }
  return false;
}

async function status() {
  return await Promise.race([
    consoleapi.sendCommand(rusty.rcon),
    new Promise(function(resolve, reject) { setTimeout(reject, 2000); })
  ]).then(function(value, reason) {
    if (!value['error']) {
        return true;
      }
      else {
        return false;
      }
    }, function(value, reason) {
      return false;
    });
}

// Gets the name of the Rust server instance. There has to be a simpler
// way to do this search and string isolation...
function getInstance() {
  return new Promise(function(resolve, reject) {
    try {
      if (rusty.launchfile) {
        var instream   = fs.createReadStream(rusty.launchfile);
        var outstream  = new stream;
        var launchfile = readline.createInterface(instream, outstream);

        launchfile.on('line', function(line) {
          var firstString = line.search("server.hostname");
          if (firstString != -1) {
            var secondString = line.slice(firstString+15).replace(/^\s+/, '');

            var forthString;
            if (secondString[0] == '"') {
              var res = secondString.match(/"(.*?)"/i);
              forthString = res ? res[1] : null;
            } else {
              forthString = secondString.match(/\w+/)[0];
            }
            if (forthString == -1 || forthString == "" || forthString == false) {
              forthString = null;
            } else {
              forthString = forthString.trim();
            }
            resolve(forthString);
          }
        });

        launchfile.on('close', function() {
        });
      }
    } catch(e) {
      console.log(e);
    }
  });
}

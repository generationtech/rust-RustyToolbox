#!/usr/bin/env node
'use strict';

//
//  TBD
//
/*
      Change seed on 1st Thursday upgrade

      Log file functionality
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
var cp         = require("child_process");

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
  seedDate: new Date(1 + " January 1900"),
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
  seedDate:     new Date(),
  emuser:       null,
  empass:       null,
  emupdate:     false,
  emunavail:    false,
  emailUpdate:  null,
  emailUnavail: null,
  launchfile:   null,
  launchdir:    null,
  instance:     null,
  eminstance:   null,
  unavail:      10,
  failsafe:     5,
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
  .option('-n, --failsafe <multiplier>',  `unavail multiplier to recover crashed server`)
  .option('-a, --announce <message>',     `pre-upgrade in-game message`)
  .option('-b, --ticks <number>',         `number of times to repeat update message`)
  .option('-u, --emuser <email address>', `email address for sending email`)
  .option('-v, --empass <password>',      `email user password`)
  .option('-w, --emupdate',               `enable sending email for updates`)
  .option('-x, --emunavail',              `enable sending email for unavailability`)
  .option('-l, --launchfile <filename>',  `name of batch file to launch Rust`)
  .option('-m, --launchdir <path>',       `directory of launchfile batch file`)
  .option('-f, --forcecfg',               `config file overrides command-line options`)
  .parse(process.argv);

rusty.config    = program.config ? program.config : defaults.config;
rusty.operation = states.RUNNING;

//
// MAIN LOOP
//
(async ()=> {
  var steamBuildid = null;
  var announceTick = 0;
  var unavail      = 0;

  while (rusty.operation != states.STOP) {

    // check if we need to read config values from file
    await checkConfig(rusty.config);

//    console.log("seedDate: " + rusty.seedDate.valueOf());
//    console.log(new Date());

    if (isFirstThursday()) {
      checkSeed();
    }

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
        // if the Rust server is not actually running, start it
        if (!(await checkTask(rusty.launchfile))) {
          console.log("Server was not running, starting now");
          if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "not running, starting now", rusty.eminstance + "not running, starting now");
          await restartServer();
          unavail = 0;
          // snooze the process a bit
          await new Promise((resolve, reject) => setTimeout(() => resolve(), 10000));
        } else {
          if (unavail >= (rusty.unavail * rusty.failsafe)) {
            console.log("Server fatal unresponsive, killing task");
            if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "fatal unresponsive, killing task", rusty.eminstance + "fatal unresponsive, killing task");
            await restartServer();
            unavail = 0;
          } else {
            console.log("Server not responding (" + unavail + " attempt" + (unavail == 1 ? "" : "s") + ")");
            if (unavail == rusty.unavail) {
              if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "not responding", rusty.eminstance + "not responding");
            }
          }
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
        if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "rebooting for update to buildid " + steamBuildid, rusty.eminstance + "rebooting for update to buildid " + steamBuildid);
        rusty.rcon.command = 'quit';
        try {
          rusty.operation = states.REBOOT;
          unavail = 0;
          let retval = await consoleapi.sendCommand(rusty.rcon);
          // Get new seed 1st reboot of every 1st Thursday of the month
          if (isFirstThursday()) {
            checkSeed();
          }
        } catch(e) {
          console.log('console command returned error: ' + e)
        }
      }

      // monitor for server to come back online
      else if (rusty.operation == states.REBOOT) {
        if (await checkStatus()) {
          if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "back online after update to buildid " + steamBuildid, rusty.eminstance + "back online after update");
          console.log('Server back online after update');
          rusty.manifestDate = new Date();
          try {
            await checkManifest(rusty.manifest);
          } catch(e) {
            console.log(e)
          }
          rusty.operation = states.RUNNING;
          unavail = 0;
        } else {
          unavail++;
          if (unavail >= (rusty.unavail * rusty.failsafe)) {
            console.log("Server fatal unresponsive, killing task");
            if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "fatal unresponsive, killing task", rusty.eminstance + "fatal unresponsive, killing task");
            await restartServer();
            unavail = 0;
          }
        }
      }
    }
    // snooze the process a bit
    await new Promise((resolve, reject) => setTimeout(() => resolve(), rusty.timer));
  }
  process.exit(0);
})();
//
// END MAIN LOOP
//


function readFile(file) {
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
        var data      = await readFile(file);
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

      // handle standard (easy) config options
      setConfig(jsonConfig, rusty, "manifest");
      setConfig(jsonConfig, rusty, "timer");
      setConfig(jsonConfig, rusty, "announce");
      setConfig(jsonConfig, rusty, "ticks");
      setConfig(jsonConfig, rusty, "seedDate");
      setConfig(jsonConfig, rusty, "emuser");
      setConfig(jsonConfig, rusty, "empass");
      setConfig(jsonConfig, rusty, "emupdate");
      setConfig(jsonConfig, rusty, "emunavail");
      setConfig(jsonConfig, rusty, "emailUpdate");
      setConfig(jsonConfig, rusty, "emailUnavail");
      setConfig(jsonConfig, rusty, "launchfile");
      setConfig(jsonConfig, rusty, "launchdir");
      setConfig(jsonConfig, rusty, "unavail");
      setConfig(jsonConfig, rusty, "failsafe");
      setConfig(jsonConfig, rusty.rcon, "server");
      setConfig(jsonConfig, rusty.rcon, "password");

      // tweaks needed for some config options
      if (!rusty.launchdir.match(/.\\$/)) {
        rusty.launchdir += "\\";
      }
      rusty.instance   = await getInstance();
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
  console.log(`seedDate:      ${rusty.seedDate}`);
  console.log(`emuser:        ${rusty.emuser}`);
  console.log(`empass:        ${rusty.empass}`);
  console.log(`emupdate:      ${rusty.emupdate}`);
  console.log(`emunavail:     ${rusty.emunavail}`);
  console.log(`emailUpdate:   ${rusty.emailUpdate}`);
  console.log(`emailUnavail:  ${rusty.emailUnavail}`);
  console.log(`launchfile:    ${rusty.launchfile}`);
  console.log(`launchdir:     ${rusty.launchdir}`);
  console.log(`instance:      ${rusty.instance}`);
  console.log(`unavail:       ${rusty.unavail}`);
  console.log(`failsafe:      ${rusty.failsafe}`);
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
        var instream   = fs.createReadStream(rusty.launchdir + rusty.launchfile);
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

async function findTask(target) {
  return new Promise(function(resolve, reject) {
  // Result of that command always returns 2 extra pid's, for the wmic process itself.
  // Create an array of all returned pid's and kill them all. Some will no longer
  // exist by now of course
    var query;
    // this current design only allows one Rust server per windows server login
    if (target == 'RustDedicated.exe') {
      query = "commandline LIKE '%RustDedicated.exe%'";
    } else {
      query = "commandline LIKE '%cmd%' AND commandline LIKE '%" + target + "%'";
    }

    cp.exec(`wmic process where "` + query + `" get ProcessId | MORE +1`,
      function(error, data) {
        newarray = '';
        if (data) {
          var oldarray = data.trim().split("\r\n");
          var newarray = oldarray.map(function(e) {
            e = e.trim();
            return e;
          });
        }
        resolve(newarray);
      }
    );
  });
}

async function checkTask(target) {
  var res = await findTask(target);
  // When there are 3 or more running tasks, then the single task we're looking
  // for is running (other pids are artifacts from query itself)
  if (res.length >= 3) {
    return true;
  }
  return false;
}

async function endTask(target) {
  return new Promise(async function(resolve, reject) {
    var pidList = await findTask(target);
    pidList.forEach(function(item) {
      cp.exec(`taskkill /t /f /pid ${item}`,
        function(error, data) {
      });
    });
    resolve();
  });
}

async function startRust() {
  await cp.exec(`start cmd /c "cd ` + rusty.launchdir + ` && ` + rusty.launchfile + `"`,
    function(error, data) {
  });
}

async function restartServer() {
  await endTask("RustDedicated.exe");
  await endTask(rusty.launchfile);
  await startRust();
}

function isFirstThursday() {
//  console.log(new Date());
  var todayDay = new Date();
//  console.log("todayDay: " + todayDay);
  var targetDay, curDay = 0, i = 1;

  while(curDay < 1 && i < 31) {
//    console.log("todayDay.getMonth: " + todayDay.getMonth());
//    console.log("todayDay.getFullYear: " + todayDay.getFullYear());
    targetDay = new Date(todayDay.getMonth()+1 + " " + ((i++) + 21) + " " + todayDay.getFullYear());
//    console.log("targetDay: " + targetDay);
    if(targetDay.getDay() == 2) curDay++;
  }
  todayDay  = todayDay.setHours(0,0,0,0);
  targetDay = targetDay.setHours(0,0,0,0);

  if(todayDay.valueOf() == targetDay.valueOf()) {
    return true;
  } else {
    return false;
  }
}

function checkSeed() {
  var dateNow = new Date();
  dateNow     = dateNow.setHours(0,0,0,0);
  // only set if no pre-existing seed or seed not already set today
  if ((rusty.seedDate.valueOf() == -2208970800000) || (rusty.seedDate.valueOf() < dateNow.valueOf())) {
    console.log("changing seed");
    newSeed(getRandomInt(0, 2147483647), getRandomInt(0, 2147483647));
    readWriteConfig(dateNow);
    rusty.seedDate = dateNow;
  } else {
    console.log("not changing seed");
  }
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

async function newSeed(seed, salt) {

  var data = await readFile(rusty.launchdir + rusty.launchfile);
//  console.log("data: " + data);

  var oldarray = data.trim().split("\r\n");
  console.log("oldarray: " + oldarray);
  console.log();

//  console.log("array elements");
  oldarray.forEach(function(item, index) {
    var firstString = item.search("RustDedicated.exe");
    if (firstString != -1) {
      var secondString = item.search("server.seed");
      if (secondString != -1) {
        var firstItem = item.substring(0, secondString + 11);
//        console.log("secondString: " + secondString);
        console.log("firstItem: " + firstItem);
        console.log();
        var secondItem = item.substring(secondString + 11).trim();
        item = firstItem + " " + seed;
        console.log("secondItem: " + secondItem);
        console.log();
        var thirdItem = secondItem.match(/\s.*/);
        if (thirdItem) {
          thirdItem = thirdItem[0].trim();
          console.log("thirdItem: " + thirdItem);
          console.log();
          item += " " + thirdItem;
        }
        oldarray[index] = item;
      } else {

      }

      var secondString = item.search("server.salt");
      if (firstString != -1) {

      } else {

      }

    }
//    console.log(item);
  });
  console.log("oldarray: " + oldarray);

}

function readWriteConfig(seedDate) {

}

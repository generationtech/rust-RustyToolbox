#!/usr/bin/env node
'use strict';

//
//  RustyNail
//      Monitor Steam for Rust server updates and notify a Rust server to update itself
//
//  (Probably uses too much global variables and such.
//   Needs a refactoring now that the proof of concept is solid.)
//

//  Get external libraries
var fs         = require('fs');
var readline   = require('readline');
var stream     = require('stream');
var vdf        = require('vdf');
var program    = require('commander');
var nodemailer = require('nodemailer');
var cp         = require("child_process");

var branchapi  = require('../rustybranch/branchapi');
var consoleapi = require('../rustyconsole/consoleapi');

//  Script operational modes used by state machine design
var states = {
  STOP:     0,   // Shut down RustyNail and exit
  BOOT:     1,   // Startup operations
  RUNNING:  2,   // Normal operation. checking for updates and server availability
  ANNOUNCE: 3,   // Server upgrade needed, announce to online players
  UPGRADE:  4,   // Server upgrade needed and announced, ready to reboot
  REBOOT:   5,   // Server upgrade needed, announced, rebooted, now watch for server to come back online
}

//  Data used to communicate with the RCON interface
var rconObj = {
  socket:   null,   //  Working var for websocket interface
  server:   null,   //  Default IP address/port for Rust server web RCON
  password: null,   //  Default web RCON password
  command:  null,   //  Command to send to Rust server console
  id:       1,      //  Message id sent along with command; id is sent back with return message
  json:     null,   //  Return results as JSON, otherwise line-by-line text
  quiet:    null,   //  Don't display any return message
};

//  Process operational values
var rusty = {
  rcon:         rconObj,
  operation:    states.RUNNING, //  Current operational mode of RustyNail
  config:       null,           //  location/name of configuration file
  configDate:   new Date(),     //  DateTime config file was last changed and read
  manifest:     null,           //  Location of Rust server Steam current state
  manifestDate: new Date(),     //  DateTime manufest file was last changed and read
  seedDate:     new Date(),     //  Previous date of new seed has been saved to the config file
  buildid:      null,           //  Current buildid of Rust server
  branch:       null,           //  Development branch of Rust server
  instance:     null,           //  Rust server name
  launchfile:   null,           //  Name of batch file used to start Rust server
  launchdir:    null,           //  Location of batch file used to start Rust server
  autostart:    true,           //  Does script perform Rust server autostart if not already running?
  autofail:     true,           //  Does script perform Rust server recovery if it permanently stops responding?
  autoupdate:   true,           //  Does script perform Rust server updating when they become available?
  timer:        null,           //  Delay in miliseconds between main loop cycles
  timeout:      null,           //  Timeout in miliseconds for messages that check Rust server availability
  unavail:      10,             //  How many main loop cycles a server can be unavailable before sending unavail email notive
  failsafe:     5,              //  Multiplier x unavail for Rust server to be considered permanently unavailable and needs taskkill
  announce:     null,           //  Message displayed in-game before server reboots for updates
  ticks:        5,              //  How many times to send Rust server in-game message to online players
  emuser:       null,           //  Login username for sending email notifications
  empass:       null,           //  Login password for sending email notifications
  emupdate:     false,          //  Email notifications for server updates?
  emunavail:    false,          //  Email notifications when server is unavailable beyond "ticks" count
  emailUpdate:  null,           //  List of email address recipients for server update notifications
  emailUnavail: null,           //  List of email address recipients for server unavailability notifications
  eminstance:   null,           //  Text prefix for email notifications (usally server instance name)
};

//  Setup some critical default values
var defaults = {
  appID:        `258550`,   //  Steam depot id for Rust dedicated server
  server:       `127.0.0.1:28016`,
  password:     ``,
  config:       `rustytoolbox.json`,
  manifest:     `C:\\Server\\rustds\\steamapps\\appmanifest_258550.acf`,
  seedDate:     new Date(1 + " January 1900"),  //  Default dummy value to indicate no previous date of new seed has been saved to the config file
  autostart:    true,
  autofail:     true,
  autoupdate:   true,
  timer:        60000,
  timeout:      2000,
  announce:     `Update released by Facepunch, server rebooting to update`,
  ticks:        5,
};

var datetimeOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
};


//  Process command-line options
program
  .version('0.5.0')
  .usage('[options]')
  .option('-c, --config <file>' ,         `path and filename of optional config file`)
  .option('-s, --server <host:port>' ,    `server IP address:port`)
  .option('-p, --password <password>',    `server password`)
  .option('-m, --manifest <path>',        `location of manifest file`)
  .option('-l, --launchfile <filename>',  `name of batch file to launch Rust`)
  .option('-m, --launchdir <path>',       `directory of launchfile batch file`)
  .option('-i, --autostart',              `disable autostart by setting false`)
  .option('-j, --autofail',               `disable failsafe recovery by setting false`)
  .option('-k, --autoupdate',             `disable updates by setting false`)
  .option('-t, --timer <milliseconds>',   `check loop timer in milliseconds`)
  .option('-o, --timeout <milliseconds>', `timeout value for RCON availability checks`)
  .option('-n, --unavail <number>',       `unavailability ticks`)
  .option('-n, --failsafe <multiplier>',  `unavail multiplier to recover crashed server`)
  .option('-a, --announce <message>',     `pre-upgrade in-game message`)
  .option('-b, --ticks <number>',         `number of times to repeat update message`)
  .option('-u, --emuser <email address>', `email address for sending email`)
  .option('-v, --empass <password>',      `email user password`)
  .option('-w, --emupdate',               `enable sending email for updates`)
  .option('-x, --emunavail',              `enable sending email for unavailability`)
  .option('-f, --forcecfg',               `config file overrides command-line options`)
  .parse(process.argv);

//  Most important to know where the config file is located!!!
rusty.config    = program.config ? program.config : defaults.config;

//
//  MAIN LOOP
//
(async ()=> {
  var steamBuildid = null;
  var announceTick = 0;
  var unavail      = 0;

  while (rusty.operation != states.STOP) {

    //  Check if we need to read config values from file
    await checkConfig(rusty.config);

    //  NORMAL RUNNING MODE, check for updates and unavailability
    if (rusty.operation == states.RUNNING) {
      if (await checkStatus()) {                //  Is online?
        if (unavail >= rusty.unavail) {         //  Was server offline before?
          console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server back online after being unresponsive");
          if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "back online after being unresponsive", rusty.eminstance + "back online after being unresponsive");
        }
        unavail = 0;
        try {
          await checkManifest(rusty.manifest);  //  Update buildid & branch from Rust server
        } catch(e) {
          console.log(e)
        }
        try {
          if (rusty.branch) {                   //  Get the current distribution Rust server buildid from Steam
            let retval = await branchapi.getBuildID(defaults.appID, rusty.branch);
            if (retval) steamBuildid = retval;
          }
        } catch(e) {
          console.log(e)
        }
        console.log((new Date()).toLocaleString('en-US', datetimeOptions) + `:  Server: ${rusty.buildid} Steam: ${steamBuildid}`);
      } else {
        unavail++;
        //  If the Rust server is not actually running, start it
        if ((!(await checkTask(rusty.launchfile))) && (rusty.autostart)) {
          console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server was not running, starting now");
          if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "not running, starting now", rusty.eminstance + "not running, starting now");
          await restartServer();
          unavail = 0;
          //  Snooze the process a bit
          await new Promise((resolve, reject) => setTimeout(() => resolve(), 10000));
        } else {
          //  Is Rust server permanently unavailable?
          if ((unavail >= (rusty.unavail * rusty.failsafe)) && (rusty.autofail)) {
            console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server fatal unresponsive, killing task");
            if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "fatal unresponsive, killing task", rusty.eminstance + "fatal unresponsive, killing task");
            await restartServer();
            unavail = 0;
          } else {
            //  Rust server is temporarily unavailable
            console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server not responding (" + unavail + " attempt" + (unavail == 1 ? "" : "s") + ")");
            if (unavail == rusty.unavail) {
              if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "not responding", rusty.eminstance + "not responding");
            }
          }
        }
      }
    }

    //  MONITOR FOR UPDATES
    if ((rusty.buildid != steamBuildid) && (rusty.autoupdate)) {
      //  New update ready from Facepunch

      //  IN-GAME ANNOUNCEMENTS
      if (rusty.operation == states.RUNNING || rusty.operation == states.ANNOUNCE) {
        //  Send Rust in-game messages to those players online
        if (announceTick < rusty.ticks  && rusty.announce) {
          rusty.operation = states.ANNOUNCE;
          console.log((new Date()).toLocaleString('en-US', datetimeOptions) + `:  Buildid ` + rusty.buildid + ` differs ` + steamBuildid + `, announcing update`);
          rusty.rcon.command = 'say "Build_ID ' + steamBuildid + ' - '  + rusty.announce + ' (' + (rusty.timer / 1000) * (rusty.ticks - announceTick) + ' seconds)"';
          try {
            let retval = await consoleapi.sendCommand(rusty.rcon);
          } catch(e) {
            console.log('console command returned error: ' + e)
          }
          announceTick++;
        } else {
          //  Trigger actual server update process
          announceTick = 0;
          rusty.operation = states.UPGRADE;
        }
      }

      // SIGNAL UPDATE TO SERVER
      if (rusty.operation == states.UPGRADE) {
        console.log((new Date()).toLocaleString('en-US', datetimeOptions) + `:  Buildid differs, updating server`);
        if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "rebooting for update to buildid " + steamBuildid, rusty.eminstance + "rebooting for update to buildid " + steamBuildid);
        rusty.rcon.command = 'quit';
        try {
          rusty.operation = states.REBOOT;
          unavail = 0;
          let retval = await consoleapi.sendCommand(rusty.rcon);
          //  Get new seed 1st update-caused reboot of every 1st Thursday of the month
          if (isFirstThursday()) {
            checkSeed();
          }
        } catch(e) {
          console.log('console command returned error: ' + e)
        }
      }

      //  MONITOR FOR SERVER REBOOT
      else if (rusty.operation == states.REBOOT) {
        if (await checkStatus()) {                //  Is online?
          if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "back online after update to buildid " + steamBuildid, rusty.eminstance + "back online after update to buildid " + steamBuildid);
          console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ':  Server back online after update');
          rusty.manifestDate = new Date();
          try {
            await checkManifest(rusty.manifest);  //  Update buildid & branch from Rust server
          } catch(e) {
            console.log(e)
          }
          rusty.operation = states.RUNNING;
          unavail = 0;
        } else {
          unavail++;
          //  Is Rust server permanently unavailable?
          if ((unavail >= (rusty.unavail * rusty.failsafe)) && (rusty.autofail)) {
            console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server fatal unresponsive, killing task");
            if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "fatal unresponsive, killing task", rusty.eminstance + "fatal unresponsive, killing task");
            await restartServer();
            unavail = 0;
          }
        }
      }
      //  End server update process
    }
    //  Main loop cycle ends
    await new Promise((resolve, reject) => setTimeout(() => resolve(), rusty.timer));   //  Snooze the process a bit
  }
  process.exit(0);
})();
//
//  END MAIN LOOP
//

function readFile(file) {
//  Reads all data from a file and returns the result.
//  Only good for smaller sized files.
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
//  Try not to waste time re-reading rust server manifest after booting
//  RustyNail unless the modified date/time changes, which would indicate
//  the server was updated or re-installed outside of script control
//  while script was running.
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
//  Loads all the script configuration values from either
//  command-line options, configuration file, or program defaults.
//  Check config file date/time and reload if the file is updated.
  var stats = fs.statSync(file)
  if (stats.mtime.getTime() != rusty.configDate.getTime()) {
    try {
      var jsonConfig = JSON.parse(fs.readFileSync(file, 'utf8'));

      //  Handle standard (easy) config options
      setConfig(jsonConfig, rusty, "manifest");
      setConfig(jsonConfig, rusty, "seedDate");
      setConfig(jsonConfig, rusty, "launchfile");
      setConfig(jsonConfig, rusty, "launchdir");
      setConfig(jsonConfig, rusty, "autostart");
      setConfig(jsonConfig, rusty, "autofail");
      setConfig(jsonConfig, rusty, "autoupdate");
      setConfig(jsonConfig, rusty, "timer");
      setConfig(jsonConfig, rusty, "timeout");
      setConfig(jsonConfig, rusty, "unavail");
      setConfig(jsonConfig, rusty, "failsafe");
      setConfig(jsonConfig, rusty, "announce");
      setConfig(jsonConfig, rusty, "ticks");
      setConfig(jsonConfig, rusty, "emuser");
      setConfig(jsonConfig, rusty, "empass");
      setConfig(jsonConfig, rusty, "emupdate");
      setConfig(jsonConfig, rusty, "emunavail");
      setConfig(jsonConfig, rusty, "emailUpdate");
      setConfig(jsonConfig, rusty, "emailUnavail");

      setConfig(jsonConfig, rusty.rcon, "server");
      setConfig(jsonConfig, rusty.rcon, "password");

      //  Tweaks needed for some other config options
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
//  Decision tree to set a sigle config value from
//  either command-line, config file, or defaults,
//  otherwise set to null for novel vars.
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
  console.log(`rcon.socket:   ${rusty.rcon.socket}`);
  console.log(`rcon.server:   ${rusty.rcon.server}`);
  console.log(`rcon.password: ${rusty.rcon.password}`);
  console.log(`rcon.command:  ${rusty.rcon.command}`);
  console.log(`rcon.id:       ${rusty.rcon.id}`);
  console.log(`rcon.json:     ${rusty.rcon.json}`);
  console.log(`rcon.quiet:    ${rusty.rcon.quiet}`);
  console.log(`operation:     ${rusty.operation}`);
  console.log(`config:        ${rusty.config}`);
  console.log(`configDate:    ${rusty.configDate}`);
  console.log(`manifest:      ${rusty.manifest}`);
  console.log(`manifestDate:  ${rusty.manifestDate}`);
  console.log(`seedDate:      ${rusty.seedDate}`);
  console.log(`buildid:       ${rusty.buildid}`);
  console.log(`branch:        ${rusty.branch}`);
  console.log(`instance:      ${rusty.instance}`);
  console.log(`launchfile:    ${rusty.launchfile}`);
  console.log(`launchdir:     ${rusty.launchdir}`);
  console.log(`autostart:     ${rusty.autostart}`);
  console.log(`autofail:      ${rusty.autofail}`);
  console.log(`autoupdate:    ${rusty.autoupdate}`);
  console.log(`timer:         ${rusty.timer}`);
  console.log(`timeout:       ${rusty.timeout}`);
  console.log(`unavail:       ${rusty.unavail}`);
  console.log(`failsafe:      ${rusty.failsafe}`);
  console.log(`announce:      ${rusty.announce}`);
  console.log(`ticks:         ${rusty.ticks}`);
  console.log(`emuser:        ${rusty.emuser}`);
  console.log(`empass:        ${rusty.empass}`);
  console.log(`emupdate:      ${rusty.emupdate}`);
  console.log(`emunavail:     ${rusty.emunavail}`);
  console.log(`emailUpdate:   ${rusty.emailUpdate}`);
  console.log(`emailUnavail:  ${rusty.emailUnavail}`);
  console.log(`eminstance:    ${rusty.eminstance}`);
  console.log();
}

function sendEmail(eaddress, esubject, emessage) {
//  Sends a single notification email from the system.
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
      console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ':  Emailed: ' + eaddress);
    }
  });
}

function sendEmails(elist, esubject, emessage) {
//  Send emails to a list of recipients.
  elist.forEach(function(element) {
      sendEmail(element, esubject, emessage);
  });
}

async function checkStatus() {
//  Sends a RCON message to check whether the Rust
//  server is available and responsive.
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
//  Checks the status of a Rust server. Uses multiple promise calls
//  in a race function with one as a simple timer. Either the status
//  message returns in time, or the timeout returns and the entire
//  reuest is canceled and status is returned as false.
  return await Promise.race([
    consoleapi.sendCommand(rusty.rcon),
    new Promise(function(resolve, reject) { setTimeout(reject, rusty.timeout); })
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

function getInstance() {
//  Gets the name of the Rust server instance. There has to be a simpler
//  way to do this search and string isolation...
  return new Promise(function(resolve, reject) {
    try {
      if (rusty.launchfile) {
        var instream   = fs.createReadStream(rusty.launchdir + rusty.launchfile);
        var outstream  = new stream;
        var launchfile = readline.createInterface(instream, outstream);

        launchfile.on('line', function(line) {
          //  This seems like a really ugly way to parse the instance name
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
//  Result of that command always returns 2 extra pid's, for the wmic process itself.
//  Create an array of all returned pid's and kill them all. Some will no longer
//  exist by now of course.
  return new Promise(function(resolve, reject) {
    var query;
    //  This current design only allows one Rust server per Windows server login
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
//  When there are 3 or more running tasks, then the single task we're looking
//  for is running (other pids are artifacts from query itself).
  var res = await findTask(target);
  if (res.length >= 3) {
    return true;
  }
  return false;
}

async function endTask(target) {
//  Kill each task associated with a pid, probably
//  some of these will no longer exist beforehand.
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
//  Could be made more generic, but to start, just
//  check if today is 1st Thursday of the month.
  var todayDay = new Date();
  var targetDay, curDay = 0, i = 1;

  while(curDay < 1 && i < 31) {
    targetDay = new Date(todayDay.getMonth()+1 + " " + i++ + " " + todayDay.getFullYear());
    if(targetDay.getDay() == 4) curDay++;
  }
  todayDay  = todayDay.setHours(0,0,0,0);   //  Only need to match day
  targetDay = targetDay.setHours(0,0,0,0);

  if(todayDay.valueOf() == targetDay.valueOf()) {
    return true;
  } else {
    return false;
  }
}

function checkSeed() {
//  Set a new seed in the Rust server launching batch file. Only
//  set if no pre-existing seed or seed not already set today, like
//  on 1st Thurday where Facepunch releases extra updates that same day).
  var dateNow = new Date();
  dateNow     = dateNow.setHours(0,0,0,0);
  if ((rusty.seedDate.valueOf() == -2208970800000) || (rusty.seedDate.valueOf() < dateNow.valueOf())) {
    console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Update on 1st Thursday, changing to new seed and salt");
    var nextSeed = getRandomInt(0, 2147483647);
    var nextSalt = getRandomInt(0, 2147483647);   //  Hope this range is OK for salt value, couldn't find reference
    if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "update on 1st Thursday, changing to new seed " + nextSeed + " and salt " + nextSalt, rusty.eminstance + "update on 1st Thursday, changing to new seed " + nextSeed + " and salt " + nextSalt);
    rusty.seedDate = dateNow;
    readWriteConfig(dateNow);
    newSeed(nextSeed, nextSalt);
  }
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

async function newSeed(seed, salt) {
//  Save the new seed and salt in the launch file batch file.
  var data     = await readFile(rusty.launchdir + rusty.launchfile);
  var oldarray = data.trim().split("\r\n");

  oldarray.forEach(function(item, index) {
    //  Does this is line containing server startup command line?
    var firstString = item.search("RustDedicated.exe");
    if (firstString != -1) {
      //  Update or replace the seed and salt values
      var itemNew     = item.trim();
      itemNew         = replaceEntry(itemNew, "server.seed", seed);
      oldarray[index] = replaceEntry(itemNew, "server.salt", salt);
    }
  });
  //  Write the new commnand line out to the batch file
  fs.truncate(rusty.launchdir + rusty.launchfile, 0, function() {
      fs.writeFileSync(rusty.launchdir + rusty.launchfile, oldarray.join("\r\n"), function (err) {
          if (err) {
              return console.log("Error writing file: " + err);
          }
      });
  });
  await restartServer();
}

function replaceEntry(item, entry, value) {
//  Replace an individual entry in the Rust batch file
//  launcher command-line. If doesn't already exist, add it to the end.
  var itemNew = item;
  // does it contain an existing entry value?
  var secondString = item.search(entry);
  if (secondString != -1) {
    // found existing entry value, updating it
    var firstItem = item.substring(0, secondString + 11);
    // add a new entry value
    itemNew = firstItem + " " + value;
    // remove all outside whitespace from second part
    var secondItem = item.substring(secondString + 11).trim();
    // is there a second part with additional command line entries?
    var thirdItem = secondItem.match(/\s.*/);
    if (thirdItem) {
      // there is addional entries, clean them up and add
      thirdItem = thirdItem[0].trim();
      itemNew += " " + thirdItem;
    }
  } else {
    // no existing entry, adding one
    itemNew += " +" + entry + " " + value;
  }
  return itemNew;
}

function readWriteConfig(seedDate) {
//  Update the config file with the date the seed & salt were updated.
  var jsonConfig = JSON.parse(fs.readFileSync(rusty.config, 'utf8'));
  jsonConfig.seedDate = seedDate;

  fs.writeFileSync(rusty.config, JSON.stringify(jsonConfig, null, 4), 'utf8', function (err) {
      if (err) {
          return console.log(err);
      }
  });
}

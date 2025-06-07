#!/usr/bin/env node
'use strict';

// RustyNail
// Monitor Steam for Rust server updates and notify a Rust server to update itself

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const util = require('util');
const cpExec = util.promisify(require('child_process').exec);
const readline = require('readline');
const stream = require('stream');
const vdf = require('vdf');
const program = require('commander');
const nodemailer = require('nodemailer');
const cp = require("child_process");
const branchapi = require('../rustybranch/branchapi');
const consoleapi = require('../rustyconsole/consoleapi');

const states = {
  STOP: 0,
  BOOT: 1,
  RUNNING: 2,
  ANNOUNCE: 3,
  UPGRADE: 4,
  REBOOT: 5,
};

const rconObj = {
  socket: null,
  server: null,
  password: null,
  command: null,
  id: 1,
  json: null,
  quiet: null,
};

const defaults = {
  appID: '258550',
  server: '127.0.0.1:28016',
  password: '',
  config: 'rustytoolbox.json',
  manifest: 'C:\\Server\\rustds\\steamapps\\appmanifest_258550.acf',
  seedDate: new Date("January 1, 1900"),
  autostart: true,
  autofail: true,
  autoupdate: true,
  timer: 60000,
  timeout: 2000,
  announce: 'Update released by Facepunch, server rebooting to update',
  ticks: 5,
};

const datetimeOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

const rusty = {
  rcon: rconObj,
  operation: states.RUNNING,
  config: program.config ? program.config : defaults.config,
  configDate: new Date(),
  manifest: null,
  manifestDate: new Date(),
  seedDate: new Date(),
  buildid: null,
  branch: null,
  instance: null,
  launchfile: null,
  launchdir: null,
  launchexec: null,
  autostart: true,
  autofail: true,
  autoupdate: true,
  timer: null,
  timeout: null,
  unavail: 10,
  failsafe: 5,
  announce: null,
  ticks: 5,
  emuser: null,
  empass: null,
  emupdate: false,
  emunavail: false,
  emailUpdate: null,
  emailUnavail: null,
  eminstance: null,
};

// Process command-line options
program
  .version('0.5.0')
  .usage('[options]')
  .option('-c, --config <file>', 'path and filename of optional config file')
  .option('-s, --server <host:port>', 'server IP address:port')
  .option('-p, --password <password>', 'server password')
  .option('-m, --manifest <path>', 'location of manifest file')
  .option('-l, --launchfile <filename>', 'name of batch file to launch Rust')
  .option('-d, --launchdir <path>', 'directory of launchfile batch file')
  .option('-e, --launchexec <path>', 'sub-directory/path of Rust executable')
  .option('-i, --autostart', 'disable autostart by setting false', defaults.autostart)
  .option('-j, --autofail', 'disable failsafe recovery by setting false', defaults.autofail)
  .option('-k, --autoupdate', 'disable updates by setting false', defaults.autoupdate)
  .option('-t, --timer <milliseconds>', 'check loop timer in milliseconds', defaults.timer)
  .option('-o, --timeout <milliseconds>', 'timeout value for RCON availability checks', defaults.timeout)
  .option('-n, --unavail <number>', 'unavailability ticks', defaults.unavail)
  .option('-f, --failsafe <multiplier>', 'unavail multiplier to recover crashed server', defaults.failsafe)
  .option('-a, --announce <message>', 'pre-upgrade in-game message', defaults.announce)
  .option('-b, --ticks <number>', 'number of times to repeat update message', defaults.ticks)
  .option('-u, --emuser <email address>', 'email address for sending email')
  .option('-v, --empass <password>', 'email user password')
  .option('-w, --emupdate', 'enable sending email for updates')
  .option('-x, --emunavail', 'enable sending email for unavailability')
  .option('-f, --forcecfg', 'config file overrides command-line options')
  .parse(process.argv);

// Assign command-line options to `rusty` object
Object.assign(rusty, program.opts());

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
        if ((!(await checkTask())) && (rusty.autostart)) {
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
//        if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "rebooting for update to buildid " + steamBuildid, rusty.eminstance + "rebooting for update to buildid " + steamBuildid);
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



async function readFile(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (e) {
    console.error(e);
    throw e; // It's usually better to throw the error to let the caller handle it
  }
}

async function checkManifest(file) {
  try {
    const stats = await fs.promises.stat(file);
    // If the file hasn't changed, exit early
    if (rusty.manifestDate && stats.mtime.getTime() === rusty.manifestDate.getTime()) {
      return;
    }

    const data = await fs.promises.readFile(file, 'utf8');
    const manifest = vdf.parse(data);
    if (!manifest || !manifest['AppState']) {
      return; // Or throw an error if the manifest structure is critical
    }

    // Simplified assignments with logical OR for defaults
    rusty.branch = manifest['AppState']['UserConfig']?.BetaKey || "public";
    rusty.buildid = manifest['AppState']['buildid'] || rusty.buildid;
    rusty.manifestDate = stats.mtime;

  } catch (e) {
    console.log(`Error processing manifest file ${file}:`, e);
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
      setConfig(jsonConfig, rusty, "launchexec");
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
  console.log(); // Print an empty line for spacing
  
  // Function to print properties of an object
  const printProperties = (obj, prefix = '') => {
      Object.keys(obj).forEach(key => {
          // Check if the value is an object and not null
          if (typeof obj[key] === 'object' && obj[key] !== null) {
              // Recursive call for nested objects
              printProperties(obj[key], `${prefix}${key}.`);
          } else {
              console.log(`${prefix}${key}: ${obj[key]}`);
          }
      });
  };
  
  // Print properties for rusty and rcon objects
  printProperties(rusty, 'rusty.');
  printProperties(rusty.rcon, 'rusty.rcon.');

  console.log(); // Print an empty line for spacing
}

// Create a transporter object using the default SMTP transport.
// This function assumes that rusty.emuser and rusty.empass are already set.
// Consider calling this function once and reusing the transporter object if sending multiple emails.
const createTransporter = () => nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: rusty.emuser,
        pass: rusty.empass
    }
});

// Define the sendEmail function as an async function to use await.
async function sendEmail(eaddress, esubject, emessage) {
    const transporter = createTransporter(); // Reuse transporter if applicable
    const mailOptions = {
        from: rusty.emuser,
        to: eaddress,
        subject: esubject,
        text: emessage
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ':  Emailed: ' + eaddress);
    } catch (error) {
        console.log(error);
    }
}

async function sendEmails(elist, esubject, emessage) {
  // Assuming sendEmail is now an async function.
  for (const email of elist) {
      try {
          await sendEmail(email, esubject, emessage);
      } catch (error) {
          console.log(`Failed to send email to ${email}: ${error.message}`);
      }
  }
}

async function checkStatus() {
  // Sets the RCON command to check server status.
  rusty.rcon.command = 'version';
  
  try {
    // Awaits the status check result directly without intermediate variable.
    return await status();
  } catch (error) {
    // Improved error logging for clarity.
    console.error(`Error during server status check: ${error}`);
    return false; // Explicitly returns false in case of error.
  }
}

async function status() {
  // Attempts to check the status of the Rust server. Times out if it takes too long.
  try {
    const result = await Promise.race([
      consoleapi.sendCommand(rusty.rcon),
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('Timeout')), rusty.timeout))
    ]);

    // If 'error' key is not present or false, assume successful status check.
    return !result.error;
  } catch (error) {
    console.error(`Error or timeout occurred checking server status: ${error.message}`);
    return false; // Ensure function returns false on error or timeout.
  }
}

async function getInstance() {
  // Simplifies the retrieval of the Rust server's instance name from the launch file.
  if (!rusty.launchfile) return null; // Early return if launchfile is not set.

  try {
    const filePath = path.join(rusty.launchdir, rusty.launchfile);
    const data = await fsp.readFile(filePath, 'utf8');

    // Use a regular expression to extract the instance name directly.
    const match = data.match(/server\.hostname\s+"([^"]+)"/i);
    return match ? match[1].trim() : null;
  } catch (error) {
    console.error(`Error retrieving instance name: ${error}`);
    return null; // Return null in case of any error.
  }
}

async function findTask(launcherOnly = false) {
  // Composes a query to find processes related to the Rust server based on the launcher or the Rust executable.
  let query = launcherOnly
    ? `caption LIKE '%cmd.exe%' AND commandline LIKE '%${rusty.launchdir.replace(/\\/g, '\\\\')}%' AND commandline LIKE '%${rusty.launchfile}%'`
    : `(caption LIKE '%cmd.exe%' AND commandline LIKE '%${rusty.launchdir.replace(/\\/g, '\\\\')}%' AND commandline LIKE '%${rusty.launchfile}%') OR executablepath LIKE '%${rusty.launchdir.replace(/\\/g, '\\\\')}\\\\${rusty.launchexec.replace(/\\/g, '\\\\')}%'`;

  try {
    const { stdout } = await cpExec(`wmic process where "${query}" get ProcessId 2>nul | MORE +1`);
    const processIds = stdout
      .trim()
      .split("\r\n")
      .map(line => line.trim())
      .filter(line => line);

    return processIds;
  } catch (error) {
    console.error(`Error finding tasks: ${error}`);
    return []; // Return an empty array to indicate no processes found or in case of an error.
  }
}

async function checkTask() {
  // This function checks if there is at least one task related to the Rust server launcher.
  const processIds = await findTask(true);
  return processIds.length >= 1;
}

async function endTask() {
  // Kills each task associated with a PID from the list obtained by findTask.
  const pidList = await findTask();
  for (const item of pidList) {
    try {
      await cp.promises.exec(`taskkill /t /f /pid ${item}`);
    } catch (error) {
      console.error(`Error killing process ${item}:`, error);
    }
  }
}

async function startRust() {
  await endTask();
  try {
    const { stdout, stderr } = await cpExec(`start cmd /c "cd ${rusty.launchdir} && ${rusty.launchfile}"`);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.error('Failed to start Rust:', error);
  }
}

async function restartServer() {
  console.log('Restarting Rust server...');
  try {
    await startRust();
    console.log('Rust server restarted successfully.');
  } catch (error) {
    console.error('Failed to restart Rust server:', error);
  }
}

function isFirstThursday() {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstThursday = (1 + (7 - firstDayOfMonth.getDay())) % 7 + 1; // Calculate first Thursday

  return today.getDate() === firstThursday;
}

async function checkSeed() {
  const today = new Date();
  const beginningOfDay = new Date(today.setHours(0, 0, 0, 0));

  // Check if it's time to update the seed
  if (rusty.seedDate.valueOf() === -2208970800000 || rusty.seedDate < beginningOfDay) {
    console.log(new Date().toLocaleString('en-US', datetimeOptions) + ": Update on 1st Thursday, changing to new seed and salt");

    const nextSeed = getRandomInt(0, 2147483647);
    const nextSalt = getRandomInt(0, 2147483647); // Assuming this range is acceptable for the salt value.

    if (rusty.emupdate) {
      const message = `${rusty.eminstance} update on 1st Thursday, changing to new seed ${nextSeed} and salt ${nextSalt}`;
      sendEmails(rusty.emailUpdate, message, message);
    }

    rusty.seedDate = beginningOfDay;
    await readWriteConfig(beginningOfDay);
    await newSeed(nextSeed, nextSalt);
  }
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

async function newSeed(seed, salt) {
  try {
    // Read the entire batch file contents
    const filePath = `${rusty.launchdir}\\${rusty.launchfile}`;
    let data = await fsp.readFile(filePath, 'utf8');

    // Split the batch file content into lines
    let lines = data.trim().split("\r\n");

    // Update lines with the new seed and salt values
    lines = lines.map(line => {
      if (line.includes("RustDedicated.exe")) {
        line = replaceEntry(line.trim(), "server.seed", seed);
        line = replaceEntry(line, "server.salt", salt);
      }
      return line;
    });

    // Write the updated content back to the batch file
    await fsp.writeFile(filePath, lines.join("\r\n"));

    // Restart the server
    await restartServer();
    console.log(`Updated seed to ${seed} and salt to ${salt}, and server restarted.`);
  } catch (err) {
    console.error("Error updating seed and salt in the launch file:", err);
  }
}

function replaceEntry(commandLine, entry, value) {
  // Check if the entry already exists in the command line
  const entryPattern = new RegExp(`\\+${entry} \\d+`, 'i');
  const entryExists = commandLine.match(entryPattern);

  // If the entry exists, replace its value
  if (entryExists) {
    return commandLine.replace(entryPattern, `+${entry} ${value}`);
  } else {
    // If the entry does not exist, append it to the command line
    return `${commandLine} +${entry} ${value}`;
  }
}

async function readWriteConfig(seedDate) {
  try {
    // Read the existing config
    const configContent = await fsp.readFile(rusty.config, 'utf8');
    const jsonConfig = JSON.parse(configContent);
    
    // Update the seed date
    jsonConfig.seedDate = seedDate;

    // Write the updated config back to the file
    await fsp.writeFile(rusty.config, JSON.stringify(jsonConfig, null, 4), 'utf8');
    console.log('Configuration updated successfully.');
  } catch (err) {
    console.error('Error updating configuration:', err);
  }
}

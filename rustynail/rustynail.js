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
const branchapi = require('../rustybranch/branchapi');
const consoleapi = require('../rustyconsole/consoleapi');
const { exit } = require('process');

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
  unavail: 10,
  failsafe: 5,
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
  .option('--forcecfg', 'config file overrides command-line options');   // no short flag: -f is --failsafe

// Indirection so tests can replace sleeps without waiting in real time.
const sys = {
  sleep: (ms) => new Promise((resolve, reject) => setTimeout(() => resolve(), ms)),
  // Runs a shell command that starts a long-running program (via "start") and returns once the
  // shell itself exits. Unlike exec, it doesn't connect the program to RustyNail's output pipes,
  // so it doesn't wait for the program to finish (which for a Rust server is never).
  launch: (command) => new Promise((resolve, reject) => {
    const child = require('child_process').spawn(command, { shell: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`"${command}" exited with code ${code}`))));
  }),
};

// Parse command-line options and assign them to the `rusty` object
function applyCliOptions(argv) {
  program.parse(argv);
  //  Copy only options that have a value, so an omitted -c keeps the default config path
  for (const [key, value] of Object.entries(program.opts())) {
    if (value !== undefined) rusty[key] = value;
  }
}

// State carried between main loop iterations
function newLoopState() {
  return {
    steamBuildid: null,
    announceTick: 0,
    unavail: 0,
  };
}

//
//  MAIN LOOP
//
async function main() {
  const loop = newLoopState();

  while (rusty.operation != states.STOP) {
    await tick(loop);
    //  Main loop cycle ends
    await sys.sleep(rusty.timer);   //  Snooze the process a bit
  }
  process.exit(0);
}

//  One iteration of the main loop
async function tick(loop) {

    //  Check if we need to read config values from file
    await checkConfig(rusty.config);

    //  NORMAL RUNNING MODE, check for updates and unavailability
    if (rusty.operation == states.RUNNING) {
      if (await checkStatus()) {                //  Is online?
        if (loop.unavail >= rusty.unavail) {    //  Was server offline before?
          console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server back online after being unresponsive");
          if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "back online after being unresponsive", rusty.eminstance + "back online after being unresponsive");
        }
        loop.unavail = 0;
        try {
          await checkManifest(rusty.manifest);  //  Update buildid & branch from Rust server
        } catch(e) {
          console.log(e)
        }
        try {
          if (rusty.branch) {                   //  Get the current distribution Rust server buildid from Steam
            let retval = await branchapi.getBuildID(defaults.appID, rusty.branch);
            if (retval) loop.steamBuildid = retval;
          }
        } catch(e) {
          console.log(e)
        }
        console.log((new Date()).toLocaleString('en-US', datetimeOptions) + `:  Server: ${rusty.buildid} Steam: ${loop.steamBuildid}`);
      } else {
        loop.unavail++;
        //  If the Rust server is not actually running, start it
        if ((!(await checkTask())) && (rusty.autostart)) {
          console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server was not running, starting now");
          if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "not running, starting now", rusty.eminstance + "not running, starting now");
          await restartServer();
          loop.unavail = 0;
          //  Snooze the process a bit
          await sys.sleep(10000);
        } else {
          //  Is Rust server permanently unavailable?
          if ((loop.unavail >= (rusty.unavail * rusty.failsafe)) && (rusty.autofail)) {
            console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server fatal unresponsive, killing task");
            if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "fatal unresponsive, killing task", rusty.eminstance + "fatal unresponsive, killing task");
            await restartServer();
            loop.unavail = 0;
          } else {
            //  Rust server is temporarily unavailable
            console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server not responding (" + loop.unavail + " attempt" + (loop.unavail == 1 ? "" : "s") + ")");
            if (loop.unavail == rusty.unavail) {
              if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "not responding", rusty.eminstance + "not responding");
            }
          }
        }
      }
    }

    //  MONITOR FOR UPDATES (only when both buildids are known; a failed lookup is not an update)
    if (rusty.buildid && loop.steamBuildid && (rusty.buildid != loop.steamBuildid) && (rusty.autoupdate)) {
      //  New update ready from Facepunch

      //  IN-GAME ANNOUNCEMENTS
      if (rusty.operation == states.RUNNING || rusty.operation == states.ANNOUNCE) {
        //  Send Rust in-game messages to those players online
        if (loop.announceTick < rusty.ticks  && rusty.announce) {
          rusty.operation = states.ANNOUNCE;
          console.log((new Date()).toLocaleString('en-US', datetimeOptions) + `:  Buildid ` + rusty.buildid + ` differs ` + loop.steamBuildid + `, announcing update`);
          rusty.rcon.command = 'say "Build_ID ' + loop.steamBuildid + ' - '  + rusty.announce + ' (' + (rusty.timer / 1000) * (rusty.ticks - loop.announceTick) + ' seconds)"';
          try {
            let retval = await consoleapi.sendCommand(rusty.rcon);
          } catch(e) {
            console.log('console command returned error: ' + e)
          }
          loop.announceTick++;
        } else {
          //  Trigger actual server update process
          loop.announceTick = 0;
          rusty.operation = states.UPGRADE;
        }
      }

      // SIGNAL UPDATE TO SERVER
      if (rusty.operation == states.UPGRADE) {
        console.log((new Date()).toLocaleString('en-US', datetimeOptions) + `:  Buildid differs, updating server`);
//        if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "rebooting for update to buildid " + loop.steamBuildid, rusty.eminstance + "rebooting for update to buildid " + loop.steamBuildid);
        rusty.rcon.command = 'quit';
        try {
          rusty.operation = states.REBOOT;
          loop.unavail = 0;
          let retval = await consoleapi.sendCommand(rusty.rcon);
        } catch(e) {
          //  The server may drop the connection as it quits, without replying
          console.log('console command returned error: ' + e)
        }
        //  Get new seed 1st update-caused reboot of every 1st Thursday of the month
        if (isFirstThursday()) {
          checkSeed();
        }
      }

      //  MONITOR FOR SERVER REBOOT
      else if (rusty.operation == states.REBOOT) {
        if (await checkStatus()) {                //  Is online?
          if (rusty.emupdate) sendEmails(rusty.emailUpdate, rusty.eminstance + "back online after update to buildid " + loop.steamBuildid, rusty.eminstance + "back online after update to buildid " + loop.steamBuildid);
          console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ':  Server back online after update');
          rusty.manifestDate = new Date();
          try {
            await checkManifest(rusty.manifest);  //  Update buildid & branch from Rust server
          } catch(e) {
            console.log(e)
          }
          rusty.operation = states.RUNNING;
          loop.unavail = 0;
        } else {
          loop.unavail++;
          //  Is Rust server permanently unavailable?
          if ((loop.unavail >= (rusty.unavail * rusty.failsafe)) && (rusty.autofail)) {
            console.log((new Date()).toLocaleString('en-US', datetimeOptions) + ":  Server fatal unresponsive, killing task");
            if (rusty.emunavail) sendEmails(rusty.emailUnavail, rusty.eminstance + "fatal unresponsive, killing task", rusty.eminstance + "fatal unresponsive, killing task");
            await restartServer();
            loop.unavail = 0;
          }
        }
      }
      //  End server update process
    }
}
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

//
//
// Chatgpt code note refactor this into functional code. FAIL
async function checkConfig(file) {
//  Loads all the script configuration values from either
//  command-line options, configuration file, or program defaults.
//  Check config file date/time and reload if the file is updated.
//  The config file is optional: without one, command-line options and defaults are used.
  var stats = null;
  try {
    stats = fs.statSync(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  var mtime = stats ? stats.mtime : new Date(0);
  if (mtime.getTime() != rusty.configDate.getTime()) {
    try {
      if (!stats) console.log(`Config file ${file} not found, using command-line options and defaults`);
      var jsonConfig = stats ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

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
      rusty.configDate = mtime;

      printConfig();

    } catch(e) {
      console.log(e)
    }
  }
}

// Chatgpt could not refactor this into functional code. FAIL
const booleanKeys = ['autostart', 'autofail', 'autoupdate', 'emupdate', 'emunavail'];

function setConfig(jsonConfig, rustyVar, configKey) {
//  Decision tree to set a sigle config value from
//  either command-line, config file, or defaults,
//  otherwise set to null for novel vars.
//  "Set" means present, so false, 0 and '' are kept rather than skipped.
  let value;
  if (jsonConfig.hasOwnProperty(configKey) && !program.forcecfg) {
    value = jsonConfig[configKey];
  } else if (program[configKey] !== undefined) {
    value = program[configKey];
  } else if (defaults[configKey] !== undefined) {
    value = defaults[configKey];
  } else {
    value = null;
  }
  //  The documented config example uses "true"/"false" strings for on/off options
  if (booleanKeys.includes(configKey) && typeof value === 'string') {
    if (value.trim().toLowerCase() === 'false') value = false;
    else if (value.trim().toLowerCase() === 'true') value = true;
  }
  rustyVar[configKey] = value;
}
//
//

const secretKeys = ['password', 'empass'];

function printConfig() {
  console.log(); // Print an empty line for spacing
  
  // Function to print properties of an object
  const printProperties = (obj, prefix = '') => {
      Object.keys(obj).forEach(key => {
          // Check if the value is an object and not null
          if (typeof obj[key] === 'object' && obj[key] !== null) {
              // Recursive call for nested objects
              printProperties(obj[key], `${prefix}${key}.`);
          } else if (secretKeys.includes(key) && obj[key]) {
              console.log(`${prefix}${key}: ********`);   // never log passwords
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
    // The hostname may be quoted (+server.hostname "My Server") or a single word (+server.hostname MyServer).
    const match = data.match(/server\.hostname\s+(?:"([^"]+)"|([^\s"]+))/i);
    return match ? (match[1] ?? match[2]).trim() : null;
  } catch (error) {
    console.error(`Error retrieving instance name: ${error}`);
    return null; // Return null in case of any error.
  }
}

//  This server is one of several on a shared Windows host, and endTask force-kills whole process
//  trees. The launch settings feed the process search, so they must identify this one server.
//  Returns a description of the problem, or null when the settings are usable.
function launchConfigProblem() {
  const values = { launchdir: rusty.launchdir, launchfile: rusty.launchfile, launchexec: rusty.launchexec };
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== 'string' || value.trim() === '') return `${name} is not set`;
    if (/['"%\[\]]/.test(value)) return `${name} contains a quote, % or [ ] character`;
    if (/rustadminrelease/i.test(value)) return `${name} points into a RustAdminRelease directory`;
  }
  if (!path.win32.isAbsolute(rusty.launchdir)) return `launchdir must be a full path (${rusty.launchdir})`;
  if (rusty.launchdir.split(/[\\/]+/).filter(Boolean).length < 2) return `launchdir is a drive root (${rusty.launchdir})`;
  if (/[\\/]/.test(rusty.launchfile)) return 'launchfile must be a file name without a folder';
  if (!/\.(bat|cmd)$/i.test(rusty.launchfile)) return 'launchfile must be a .bat or .cmd file';
  if (!/\.exe$/i.test(rusty.launchexec)) return 'launchexec must be an .exe file';
  if (!fs.existsSync(path.join(rusty.launchdir, rusty.launchfile))) return `launchfile ${rusty.launchfile} was not found in launchdir ${rusty.launchdir}`;
  return null;
}

//  Lists the PIDs of this Rust server's launcher cmd.exe (and, unless launcherOnly, its RustDedicated.exe).
//  Returns null when that can't be determined; callers must not read null as "not running".
async function findTask(launcherOnly = false) {
  const problem = launchConfigProblem();
  if (problem) {
    console.error(`Not looking for Rust server processes: ${problem}`);
    return null;
  }

  const wql = (s) => s.replace(/\\/g, '\\\\');                       //  WQL strings escape backslashes
  const dir = wql(rusty.launchdir.replace(/[\\/]+$/, ''));
  const file = wql(rusty.launchfile);
  //  cmd.exe running the batch file, as started by startRust (cd <dir> && <file>) or by its full path,
  //  but never the cmd.exe that runs this wmic query
  const launcher = `(caption = 'cmd.exe' AND NOT commandline LIKE '%wmic%' AND (commandline LIKE '%cd ${dir} && ${file}%' OR commandline LIKE '%${dir}\\\\${file}%'))`;
  const query = launcherOnly ? launcher : `${launcher} OR executablepath = '${dir}\\\\${wql(rusty.launchexec)}'`;

  try {
    //  Called directly (no "2>nul | MORE +1"), so a failed query rejects instead of looking like "no processes"
    const { stdout } = await cpExec(`wmic process where "${query}" get ProcessId`);
    return stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^\d+$/.test(line));
  } catch (error) {
    console.error(`Error finding tasks: ${error}`);
    return null;
  }
}

async function checkTask() {
  // This function checks if there is at least one task related to the Rust server launcher.
  const processIds = await findTask(true);
  if (processIds === null) {
    //  Unknown: report "running" so a second copy of the server is never started
    console.error('Could not check whether the Rust server is running; assuming it is');
    return true;
  }
  return processIds.length >= 1;
}

//  Kills this Rust server's processes. Returns true only when none are left afterwards.
async function endTask() {
  const pidList = await findTask();
  if (pidList === null) return false;
  if (pidList.length === 0) return true;

  for (const item of pidList) {
    const pid = Number(item);
    if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid || pid === process.ppid) {
      console.error(`Not killing process ${item}: it is RustyNail itself, its console, or a system process`);
      continue;
    }
    try {
      await cpExec(`taskkill /t /f /pid ${pid}`);
    } catch (error) {
      //  Usually the process already exited as part of an earlier tree kill
      console.error(`Error killing process ${pid}:`, error.message);
    }
  }

  await sys.sleep(2000);                                            //  Give Windows a moment to tear down
  const remaining = await findTask();
  if (remaining === null || remaining.length > 0) {
    console.error(`Rust server processes still running after kill: ${remaining === null ? 'unknown' : remaining.join(', ')}`);
    return false;
  }
  return true;
}

//  Returns true if the server was launched.
async function startRust() {
  if (!(await endTask())) {
    console.error('Not starting Rust: could not confirm that the old server processes are stopped');
    return false;
  }
  try {
    //  Not exec: exec would wait until the server exits, freezing RustyNail's main loop
    await sys.launch(`start cmd /c "cd ${rusty.launchdir} && ${rusty.launchfile}"`);
    return true;
  } catch (error) {
    console.error('Failed to start Rust:', error);
    return false;
  }
}

async function restartServer() {
  console.log('Restarting Rust server...');
  try {
    const started = await startRust();
    console.log(started ? 'Rust server restarted successfully.' : 'Rust server was NOT restarted.');
  } catch (error) {
    console.error('Failed to restart Rust server:', error);
  }
}

function isFirstThursday() {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  // Calculate the first Thursday by adding the necessary days to the first day of the month
  const firstThursday = new Date(firstDayOfMonth.setDate(1 + ((4 - firstDayOfMonth.getDay() + 7) % 7)));
  
  return today.getDate() === firstThursday.getDate() && today.getMonth() === firstThursday.getMonth();
}

async function checkSeed() {
  const today = new Date();
  const beginningOfDay = new Date(today.setHours(0, 0, 0, 0));

  // seedDate may be a Date, an ISO string (as saved since 2024) or a number (as saved before),
  // depending on where it came from; compare it as a Date. An unreadable date counts as "never".
  const seedDate = new Date(rusty.seedDate);

  // Check if it's time to update the seed
  if (isNaN(seedDate) || seedDate.valueOf() === -2208970800000 || seedDate < beginningOfDay) {
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

// Exported for tests. The main loop only runs when this file is executed directly.
module.exports = {
  states, defaults, rusty, program, sys,
  applyCliOptions, newLoopState, main, tick,
  checkConfig, setConfig, printConfig, checkManifest,
  checkStatus, status, getInstance,
  launchConfigProblem, findTask, checkTask, endTask, startRust, restartServer,
  isFirstThursday, checkSeed, getRandomInt, newSeed, replaceEntry, readWriteConfig,
  sendEmails,
};

if (require.main === module) {
  applyCliOptions(process.argv);
  main();
}

# RustyNail

Monitor Steam for Rust server updates and notify a Rust server to update itself

### Usage:

```
Usage: rustynail [options]

Options:

  -V, --version                 output the version number
  -c, --config <file>           path and filename of optional config file
  -s, --server <host:port>      server IP address:port
  -p, --password <password>     server password
  -m, --manifest <path>         location of manifest file
  -l, --launchfile <filename>   name of batch file to launch Rust
  -m, --launchdir <path>        directory of launchfile batch file
  -i, --autostart               disable autostart by setting false
  -j, --autofail                disable failsafe recovery by setting false
  -k, --autoupdate              disable updates by setting false
  -t, --timer <milliseconds>    check loop timer in milliseconds
  -o, --timeout <milliseconds>  timeout value for RCON availability checks
  -n, --unavail <number>        unavailability ticks
  -n, --failsafe <multiplier>   unavail multiplier to recover crashed server
  -a, --announce <message>      pre-upgrade in-game message
  -b, --ticks <number>          number of times to repeat update message
  -u, --emuser <email address>  email address for sending email
  -v, --empass <password>       email user password
  -w, --emupdate                enable sending email for updates
  -x, --emunavail               enable sending email for unavailability
  -f, --forcecfg                config file overrides command-line options
  -h, --help                    output usage information
```

##### Config File

Uses a JSON config file if present. Options are named the same as command-line ones and merged with those command-line options (`--forcecfg` causes config file to take precedence over command-line options if there are conflicts). During RustyNail operation, if the file changes, application will re-read config file and make adjustments as needed.

`rustytoolbox.json`

```
{
  "manifest":     "C:\\Rust\\Server\\rustds\\steamapps\\appmanifest_258550.acf",
  "timer":        60000,
  "server":       "127.0.0.1:28055",
  "announce":     "New server version released by Facepunch, rebooting to update",
  "ticks":        2,
  "emailUpdate":  [ "" ],
  "emailUnavail": [ "" ],
  "emupdate":     "false",
  "emunavail":    "false",
  "unavail":      15
}
```

### Requirements:

1. Windows Operation system

2. Nodejs installed

3. For email notifications, outbound ports required by your email server

4. Currently only manages a single Rust server instance per Windows server install

##### Rust server
The Rust server needs to be started with a \*.bat file (usually this is `Run_DS.bat`) that infinite loops through update-run-update sequence for RustyNail to work. Also, runs the update twice, because occasionally, the first run of the Steam update process leaves this file missing: `C:\Rust\Server\rustds\steamapps\appmanifest_258550.acf`

`Run_DS.bat`
```
echo off
:start

cd steam
steamcmd.exe +runscript ../update_script.txt
steamcmd.exe +runscript ../update_script.txt
cd ..

cd rustds
RustDedicated.exe <with whatever your normal command-line options are>
cd ../

goto start
```
`update_script.txt`
```
@ShutdownOnFailedCommand 1
@NoPromptForPassword 1
login anonymous
force_install_dir ../rustds
app_update 258550 validate
quit
```

### Future Enhancements:

1. More flexible scheduled seed/salt changes besides 1st update from Facepunch on the 1st Thursday of the month

2. More precise checking for need to change seed/salt. Current design just changes seed when 1st update comes out; does not actually check for network++ and forced-wipe caused by Facepunch. In general, would prefer to only change seed/salt when planned by RustyNail user or when unplanned forced-wipe by Facepunch.

3. Staged updating dependency where Rust server update requires client upgrade. Goal is to have RustyNail delay initiating a Rust server update cycle which requires a corresponding Rust client update until the client update has been released by Facepunch. This helps to prevent users running staging-branch from instantly loading into new server version before the greater Rust user population clients are upgraded...

4. Ability to manage multiple Rust server instances running on a single Windows installation

5. More flexible in-game announcement messages, especially message just before planned reboot. Current design allows countdown messages ("rebooting in 1 minute"), but unable to send last message immediately before reboot action ("rebooting now").

6. Linux version

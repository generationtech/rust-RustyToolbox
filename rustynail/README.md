# RustyNail

Monitor Steam for Rust server updates and notify a Rust server to update itself

#### Usage:

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

Uses a config file if present. If during RustyNail operation the config file changes, the program will re-read the config file and make adjustments as needed. Any command-line options override config file entries unless `--forcecfg` is specified

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

#### Requirements:

1. Runs on Windows systems and only manages Rust server running on Windows systems

#### Rust server:
The Rust server needs to be started with a \*.bat file that infinite loops through update-run-update sequence for RustyNail to work. Also, runs the update twice, because occasionally, the first run of the Steam update process leaves this file missing: `C:\Rust\Server\rustds\steamapps\appmanifest_258550.acf`

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

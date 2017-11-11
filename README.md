# RustyToolbox

Set of tools to help manage Facepunch Rust servers from Windows command line

#### [RustyNail](rustynail/)
Monitoring system that manages Rust dedicated server availability and updates

1. An always-on application to handle a Rust server's lifecycle.

2. When launched, if a Rust server is not running, RustyNail <b>starts it using the normal batch file</b> containing standard Rust server command-line options.

3. Monitors Rust server availability and <b>checks for lock-ups, crashes, or downtime</b>.

4. If the Rust server is offline (server process is not running), RustyNail will start the server. If the server is running, but locked up or otherwise unresponsive, <b>endtask the Rust server and restarts it</b>.

5. Monitors Steam for Rust server updates and <b>triggers the update cycle on the local Rust server</b>.

6. On 1st Thursday of the month, <b>changes the Rust server seed & salt</b> when update received by Facepunch.

7. Includes email notifications for Rust server availability and update activity.

8. Most every option is customizable through command-line options and merged with optional JSON-formatted config file. Changing the file while application is running causes RustyNail to reload the new config and adjust operations without requiring a restart.

#### [RustyConsole](rustyconsole/)
Sends Rust server console command from Windows command-line through networked web RCON. It's a one-and-done style of sending commands

#### [RustyBranch](rustybranch/)
Checks Steam API for Rust server and client updates on a named development branch

#### Install:

Developed with nodejs 8.6.0

1. Install nodejs for your environment

2. Extract RustyToolbox github sources

3. Run `npm i` to install needed nodejs modules

4. Run `npm link` to create a global command link

5. A copy of `steamcmd.exe` is included with our GitHub repo and should update itself when ran by the RustyToolbox utilities. If not, you can install a current version yourself by downloading it from [here](https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip) and unzipping to `steam/` . Do <b>not</b> use the `steam/` directory from your Rust server or any other active Steam game installation

#### Config:

Rusty* applications can be executed using command-line options and/or options read from a config file. Default is to read from `rustytoolbox.json` in the current directory. When used by RustyNail, if the config file is changed while application is running, it will re-read the file, compute effective options between command-line and config file, and adjust operation as needed.

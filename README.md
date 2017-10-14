# RustyToolbox

Set of tools to help manage Facepunch Rust servers from Windows command line

#### [RustyConsole](rustyconsole/)

Sends a Rust server console command from Windows command line through networked web RCON. It's a one-and-done style of sending commands

#### [RustyBranch](rustybranch/)
Checks Steam API for Rust server and client updates on a named development branch

#### [RustyNail](rustynail/)
Monitor Steam for Rust server updates and notify a Rust server to update itself

#### Install:

Developed while using nodejs 8.6.0

1. Install nodejs for your environment)

2. Extract rustyconsole github sources

3. Run `npm link` to create a global command link in either Linux or Windows

4. A copy of `steamcmd.exe` is included with our GitHub repo and should update itself when ran by the RustyToolbox utilities. If not, you can install a current version yourself by downloading it from [here](https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip) and unzipping to `steam/` . Do <b>not</b> use the `steam/` directory from your Rust server or any other active Steam game installation

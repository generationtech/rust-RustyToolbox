# RustyToolbox

Set of tools to help manage Facepunch Rust servers from Windows command line

#### [RustyConsole](rustyconsole/)
Sends Rust server console command from Windows command line through networked web RCON. It's a one-and-done style of sending commands

#### [RustyBranch](rustybranch/)
Checks Steam API for Rust server and client updates on a named development branch

#### [RustyNail](rustynail/)
Monitor Steam for Rust server updates and notify a Rust server to update itself

#### Install:

Developed with nodejs 8.6.0

1. Install nodejs for your environment

2. Extract RustyToolbox github sources

3. Run `npm i` to install needed nodejs modules

4. Run `npm link` to create a global command link

5. A copy of `steamcmd.exe` is included with our GitHub repo and should update itself when ran by the RustyToolbox utilities. If not, you can install a current version yourself by downloading it from [here](https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip) and unzipping to `steam/` . Do <b>not</b> use the `steam/` directory from your Rust server or any other active Steam game installation

#### Config:

Commands can be executed using command-line options or read from a config file. Default is to read from `rustytoolbox.json` in current directory. When used by rustynail, if the config file is changed while the program is running, it'll re-read the config and adjust operation as needed. In the startup case, any options given on the command-line will override settings in the config file.

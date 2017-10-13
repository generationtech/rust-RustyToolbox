# RustyConsole

Simple to use command-line version of webrcon for Rust servers.

Developed while using nodejs 8.6.0

<h5>Install:</h5>

1. install nodejs for your environment)

2. extract rustyconsole github sources

3. run `npm link` to create a global command link in either Linux or Windows

<h5>Usage:</h5>

```
Usage: rustyconsole [options] "RCON command sent to Rust server"

Options:

  -V, --version            output the version number
  -h, --host [optional]    host IP address:port, default 127.0.0.1:28016
  -s, --secret [optional]  host password, default blank password
  -i, --id [optional]      message id
  -j, --json               output return data as JSON
  -q, --quiet              suppress output
  -h, --help               output usage information
```

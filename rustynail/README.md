# RustyNail

Monitor Steam for Rust server updates and notify a Rust server to update itself

#### Usage:

```
Usage: rustynail [options]

Options:

  -V, --version              output the version number
  -c, --config <file>        path and filename of optional config file
  -s, --server <host:port>   server IP address:port
  -p, --password <password>  server password
  -m, --manifest <path>      location of manifest file
  -t, --timer <directory>    check loop timer in milliseconds
  -a, --announce <message>   pre-upgrade in-game message
  -b, --ticks <number>       number of times to repeat update message
  -f, --forcecfg             config file overrides command-line options
  -h, --help                 output usage information
```

Uses the rustytoolbox config file and if during rustynail operation the config file changes, the program will re-read the config file and make adjustments as needed.

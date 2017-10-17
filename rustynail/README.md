# RustyNail

Monitor Steam for Rust server updates and notify a Rust server to update itself

#### Usage:

```
Usage: rustynail [options]

Options:

  -V, --version               output the version number
  -s, --server <host:port>    server IP address:port, default 127.0.0.1:28016
  -p, --password <password>   server password, defaults to blank password
  -m, --manifest <directory>  directory containing appmanifest_258550.acf, def
aults to C:\Server\rustds\steamapps
  -t, --timer <directory>     check loop timer, defaults to 60000
  -h, --help                  output usage information
```

Uses the rustytoolbox config file and if during rustynail operation the config file changes, the program will re-read the config file and make adjustments as needed.

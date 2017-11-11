# RustyConsole

Sends Rust server console command from Windows command line through networked web RCON. It's a one-and-done style of sending commands

#### Usage:

```
Usage: rustyconsole [options] "RCON command sent to Rust server"

Options:

  -V, --version              output the version number
  -s, --server <host:port>   server IP address:port, default 127.0.0.1:28016
  -p, --password <password>  server password, defaults to blank password
  -i, --id <number>          message id
  -j, --json                 output return data as JSON
  -q, --quiet                suppress output
  -h, --help                 output usage information
```

### Future Enhancements:

1. Current design does not allow rapidly executing multiple RustyConsole commands in succession. There needs to be a slight delay between each RustyNail execution by the calling application. This seems to be caused by difficulty in quickly closing websocket connection to Rust server. 

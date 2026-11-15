# RustyConsole

Sends Rust server console commands from the Windows command line through networked web RCON. It's designed for one-off command execution but can be scripted for automated tasks.

## Usage

```plaintext
Usage: rustyconsole [options] "RCON command sent to Rust server"

Options:
  -V, --version              Output the version number
  -s, --server <host:port>   Server IP address and port, defaults to 127.0.0.1:28016
  -p, --password <password>  Server password, defaults to a blank password
  -i, --id <number>          Message ID for the RCON command
  -j, --json                 Output return data in JSON format
  -q, --quiet                Suppress all output except command results
  -h, --help                 Display this help message and exit
```

### Future Enhancements

1. **Improved Connection Handling**: Currently, rapidly executing multiple RustyConsole commands in succession requires a slight delay between each command due to challenges in quickly closing the WebSocket connection to the Rust server. Future versions will seek to optimize connection management for more immediate command execution.

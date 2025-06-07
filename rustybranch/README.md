# RustyBranch

RustyBranch is a command-line utility designed to help Rust game server administrators and developers track and check for updates on the Steam platform. It specifically targets the Rust dedicated server and client applications, allowing checks against specified development branches for the latest build IDs. This tool is ideal for automating update checks and ensuring your Rust server or client is always up to date.

## Features

- Check for the latest Rust server or client build IDs directly from the Steam API.
- Specify development branches to check for the latest updates.
- Automate server management tasks and update workflows.

## Installation

Before you begin, ensure you have Node.js installed on your system. You can download and install Node.js from [https://nodejs.org/](https://nodejs.org/).

To install RustyBranch, clone this repository to your local machine and navigate to the directory containing RustyBranch:

```sh
git clone <repository-url>
cd RustyBranch
```

Then, you can install the required dependencies using npm:

```sh
npm install
```

## Usage

RustyBranch is straightforward to use. Run it from the command line with the following options to check for updates:

```sh
Usage: rustybranch [options]

Options:
  -V, --version        Output the version number of RustyBranch.
  -s, --server         Fetch the dedicated server build ID from Steam (default).
  -c, --client         Fetch the Rust client application build ID from Steam.
  -b, --branch <name>  Specify the development branch to check. Defaults to "public".
  -h, --help           Display help and usage information.
```

### Examples

Check for the latest Rust dedicated server build ID:

```sh
rustybranch --server
```

Check for the latest Rust client build ID on a specific branch:

```sh
rustybranch --client --branch staging
```

## Contributing

Contributions to RustyBranch are welcome! Please feel free to submit pull requests or open issues to discuss proposed changes or report bugs.

## License

RustyBranch is released under the MIT License. See the LICENSE file for more details.

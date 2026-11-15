# RustyToolbox

Node.js command-line tools for running Facepunch Rust dedicated servers on Windows:
- `rustynail/rustynail.js`: an always-on monitor. It starts the server, restarts it when it's hung or down, runs Steam updates and changes the seed monthly. It also sends email alerts.
- `rustyconsole/`: sends a single WebRCON command (`consoleapi.js` holds the shared RCON call).
- `rustybranch/`: checks Steam for build IDs on a branch (`branchapi.js` runs steamcmd).

The code was hand-written from 2017 to 2022. An April 2024 ChatGPT refactor (`b0994b4`) introduced regressions, and `cf8df02` is the last commit before it. Work happens on `modernize/*` branches made from `development`.

## Environment: a live production server
This host (SQUADONE, Windows Server 2019) runs live game servers for several communities: two Rust servers, plus Squad, Valheim, Arma 3, DCS, Space Engineers, The Forest and Minecraft. It also runs postgres. **Not damaging the box comes before everything else.**

- **Dev checkout:** `D:\dev\rust-RustyToolbox`. All writes go here or to the session scratchpad.
- **Live Rust installs (read-only):**
  - `D:\games\others\rust.coolgeeks.staging\`: RCON port 28047, `rustytoolbox-staging.json`.
  - `D:\games\others\rust.coolgeeks.vanilla\`: RCON port 28017, `rustytoolbox-vanilla.json`.
  - Each has its own `RustyToolbox\` checkout, `start_server.bat`, `Run_RustyNail.bat` and `steam\` folder.
- **One RustyNail per Rust server, run permanently.** Keep that design.
- **Node:** the system Node is v22.23.5. There's also a portable copy at `D:\dev\tools\node-v22.x.y-win-x64`. Live RustyNails use whatever `node` is on PATH.
- **Shells:** Windows PowerShell 5.1 and Git Bash. `wmic` is present.

## Hard rules
1. **Everything outside `D:\dev\rust-RustyToolbox` is read-only.** That especially covers `D:\games\**`.
2. **Never read into, modify, move or delete any `RustAdminRelease` directory,** in any game server folder.
3. **No process, service or system control** (kill, stop, restart, shutdown, NSSM, `sc`, `net stop`, WMI methods) unless Ken approves that specific action.
4. **No system-wide installs:** no Node or tool installs, no `npm -g` or `npm link`, no PATH changes. Tell Ken what's needed and the exact steps; Ken installs. Project-local npm dependencies are fine.
5. **Never point a dev RustyNail or rustyconsole at a live server** unless Ken has stopped that server's live RustyNail.
6. **Tests must never kill real processes or run real steamcmd.** Use the fake WebRCON server and stub `child_process`.
7. **The kill logic is dangerous.** `findTask` builds WMI `LIKE '%…%'` patterns from `launchdir`, `launchfile` and `launchexec`, and `endTask` runs `taskkill /t /f` on every match. An empty or broad value could match every process on the box. Don't make `endTask` work (bug #1) until path validation, a refusal for any `RustAdminRelease` path, and a dry-run mode exist and are tested.
8. **Commits:** small commits on the feature branch. Don't push or merge without asking.
9. **Redact RCON and email passwords** in anything you print or summarize.

`.claude/settings.json` backs these rules with deny rules. Those rules match command text, so they're a safety net, not a guarantee.

## Running
- Install: `npm ci`
- Tests: `npm test`, using `node:test` (the harness is being added in phase 0)

## Known bugs
Pin each bug with a test before fixing it. Fix in this order: #1 (after the kill safety work), #2, #7/#10, #8, RCON hangs, then the rest.

1. `endTask` calls `cp.promises.exec`, which is undefined, so it never kills anything. A hung server stays up and a second copy gets launched.
2. A failed Steam lookup leaves `steamBuildid` as `null`, which counts as an update and causes an endless announce-and-`quit` loop.
3. `rustyconsole` ignores `-s`, `-p`, `-i`, `--json` and `-q`, and always connects to `127.0.0.1:28016`.
4. `consoleapi` resolves on the first WebSocket message, not the reply with the matching `Identifier`.
5. `rustynail` crashes without `-c` or when the config file is missing.
6. `-f` is defined for both `--failsafe` and `--forcecfg`.
7. The seed change works only once: the saved ISO string compared with `<` against a `Date` is always false.
8. An unset `unavail` or `failsafe` gives a threshold of 0, so the server is killed on its first missed check and "back online" is logged on every check.
9. `setConfig` uses truthy checks: a blank password becomes `null`, the string `"false"` counts as true, and boolean flags can't turn anything off.
10. Staging runs the old `isFirstThursday()` formula, which picks the wrong day. It's fixed on `development` in `e949109`.

Risks found by reading the code:
- **RCON hangs:** `sendCommand` has no close handler, and the `say`/`quit` calls have no timeout.
- **`findTask` errors:** if `wmic` errors, the result is `[]`, which reads as "not running", so a second copy is launched.
- **Seed restarts:** the `checkSeed` restart can kill steamcmd partway through an update.
- **Password logging:** `printConfig` logs passwords.
- **Relative paths:** `branchapi` runs `steam\steamcmd` and `del` relative to the current folder.
- **Hostname parsing:** the `getInstance` regex misses an unquoted `server.hostname`.
- **`--json` output:** it prints a Buffer under ws 8.
- **Vulnerable dependencies:** `ws` (pinned as `>=3.3.1`) and `nodemailer` 6.9 have high-severity advisories.

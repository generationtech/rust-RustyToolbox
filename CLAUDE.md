# RustyToolbox

Node.js command-line tools for running Facepunch Rust dedicated servers on Windows:
- `rustynail/rustynail.js`: an always-on monitor. It starts the server, restarts it when it's hung or down, runs Steam updates and changes the seed monthly. It also sends email alerts.
- `rustyconsole/`: sends a single WebRCON command (`consoleapi.js` holds the shared RCON call).
- `rustybranch/`: checks Steam for build IDs on a branch (`branchapi.js` runs steamcmd).

The code was hand-written from 2017 to 2022. An April 2024 ChatGPT refactor (`b0994b4`) introduced regressions, and `cf8df02` is the last commit before it. Work happens directly on `development`. Don't create feature branches.

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
8. **Git:** Claude does all git operations. Ken steps in only for what Claude can't do, such as GitHub settings or keys. Commit each fix to `development` and push it, without asking. When a task is finished, always merge `development` into `main` (a `--no-ff` merge commit, after the tests pass), fast-forward `development` to that merge, and push both. Never finish a task with local and GitHub, or `main` and `development`, out of step. `origin` uses SSH (`git@github.com:generationtech/rust-RustyToolbox.git`) with a write-enabled deploy key for this repo only, at `C:\Users\Administrator\.ssh\id_ed25519`. Ken's yes is still needed for force-pushing or rewriting pushed history, deleting branches, and deploying to the live server folders.
9. **Redact RCON and email passwords** in anything you print or summarize.

`.claude/settings.json` backs these rules with deny rules. Those rules match command text, so they're a safety net, not a guarantee.

## Running and testing
- **Install:** `npm ci`
- **Tests:** `npm test` runs `node --test test/*.test.js` in about 3 seconds. Don't use `t.mock.timers` in tests that open real sockets: it also mocks `clearTimeout`, so ws can't cancel its real 30-second close timer and the run stalls for 30 seconds. CI (`.github/workflows/test.yml`) runs it on Ubuntu and Windows.
- **Every test file must `require('./helpers/sandbox')` first.** The sandbox fakes `child_process.exec` (tests install canned output with `setExecHandler`) and blocks every other `child_process` function and `process.kill`. It also blocks all network connections except to loopback ports registered by a test fake. The only real child process tests may start is `node` itself, through `sandbox.runNode()`.
- **Test helpers in `test/helpers/`:**
  - `fake-rcon.js`: a fake WebRCON server.
  - `fake-ws-preload.js`: a fake `ws` for CLI subprocess tests.
  - `fixtures.js`: temp server folders, `rusty` state reset, console capture.
- **`knownBug(id, name, fn)`** (in `known-bug.js`): `fn` asserts the *correct* behavior. The test passes while the bug exists and fails with "looks fixed" once it's fixed. When you fix a bug, change its `knownBug(...)` to `test(...)`.
- **`rustynail.js` exports its functions.** Its main loop body is `tick(loop)`, and it only parses arguments and runs `main()` when executed directly. Tests drive it one `tick()` at a time, mocking `consoleapi.sendCommand`, `branchapi.getBuildID` and `sys.sleep`.

## Scope
**Ken's direction (2026-11-14): fix RustyNail's identified bugs, and protect the rest of the Windows server. No new features.** Ask Ken before anything beyond a bug fix: dependency upgrades, rewrites (WMIC, RCON client, config schema), new options or modes.

## Status (merged to `main` and `development`; staging deployed 2026-11-14, vanilla not yet)
Each fix has its own commit and tests:
- **Fixed:** #1 to #9, the RCON hangs, `findTask` errors, password logging, hostname parsing and `--json` output.
- **Main loop freeze after RustyNail starts the server (found on staging):** `startRust` awaited `exec('start ...')`, which waits until the server exits. It now launches with `spawn` and `stdio: 'ignore'` (`sys.launch`). Never launch long-running programs with `exec`.
- **Verified by Ken on staging:** periodic version checks, starting the server when it isn't running at startup, and restarting it when it stops.
- **#10:** already fixed on `development`. Staging gets it when it's deployed.
- **Dependency security upgrades (Ken approved 2026-11-15, merged to `main`, not yet deployed):** `ws` 8.16.0 → 8.23.0 and `nodemailer` 6.9.13 → 10.5.0. `npm audit` is clean. `test/rustynail-email.test.js` covers email alerts without touching the network. Live installs need `npm ci` after pulling.
- **#1 safety:** before RustyNail looks up, kills or starts anything, `launchConfigProblem()` must accept the launch settings. The process query matches only this server's launcher `cmd.exe` and its exact `RustDedicated.exe` path. RustyNail's own PIDs are never killed, and the server starts only once the old processes are confirmed gone. This was checked on the host with dummy processes, and both live configs pass the validation.

**Not changed, so mention them to Ken rather than fixing them:**
- **`--forcecfg` precedence:** the README says the command line wins unless `--forcecfg` is set. The code does the reverse: the config file wins unless `--forcecfg`.
- **Seed restart timing:** the first-Thursday seed change restarts the server right after `quit`. That can interrupt steamcmd's update; it was the original design.
- **`cd` doesn't change drive:** `startRust` uses `cd <launchdir>`, which doesn't switch drives. That's fine on this box, where RustyNail and the servers are both on D:.
- **Boolean flags:** `-i`, `-j` and `-k` can only turn options on. Use the config file to turn them off.
- **Relative steamcmd path:** `branchapi` runs `steam\steamcmd` relative to the current folder.
## Fixed bugs (for reference)
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

Also fixed:
- **RCON hangs:** `sendCommand` had no close handler, and the `say`/`quit` calls had no timeout.
- **`findTask` errors:** if `wmic` errored, the result was `[]`, which read as "not running".
- **Password logging:** `printConfig` logged passwords.
- **Hostname parsing:** the `getInstance` regex missed an unquoted `server.hostname`.
- **`--json` output:** it printed a Buffer under ws 8.

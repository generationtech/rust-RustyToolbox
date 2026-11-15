const cp = require("child_process");
const vdf = require('vdf');
const util = require('util');
const exec = util.promisify(cp.exec);

// Longest wait for steamcmd. RustyNail awaits this lookup in its main loop, so a steamcmd that
// stalls (on a Steam login or its own self-update, say) must not stall RustyNail with it.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// The steamcmd lookup still in progress, if any. A stalled steamcmd isn't killed (a broad kill
// could hit the steamcmd a server's own launch script runs); instead no new lookup starts until
// it ends, so stalled copies can't pile up.
let running = null;

module.exports.getBuildID = async function(appID, branch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  // Validate appID or sanitize input here
  let timer;
  try {
    if (running) {
      throw new Error('The previous steamcmd lookup is still running; skipping this check');
    }

    const lookup = (async () => {
      // Attempt to delete the cache file, log errors if any
      await exec('del steam\\appcache\\appinfo.vdf').catch(console.error);
      return exec(`steam\\steamcmd +login anonymous +app_info_update +app_info_print "${appID}" +logoff +quit`);
    })();
    running = lookup;
    const done = () => { if (running === lookup) running = null; };
    lookup.then(done, done);

    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`steamcmd gave no answer within ${timeoutMs / 1000} s; leaving it running and skipping this check`)), timeoutMs);
    });
    const { stdout } = await Promise.race([lookup, timeout]);

    const startPattern = `"${appID}"`;
    const endPattern = `steamcmd has been disconnected`;
    const startIndex = stdout.indexOf(startPattern);
    const endIndex = stdout.lastIndexOf(endPattern);

    if(startIndex === -1 || endIndex === -1) {
      throw new Error("Failed to find app information in the output.");
    }

    const vdfContent = stdout.substring(startIndex, endIndex);
    const appInfo = vdf.parse(vdfContent);
    const buildid = appInfo[appID]?.depots?.branches?.[branch]?.buildid;

    if (!buildid) {
      throw new Error(`Build ID not found for appID: ${appID}, branch: ${branch}`);
    }

    return buildid;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error; // Rethrow or handle as needed
  } finally {
    clearTimeout(timer);
  }
}

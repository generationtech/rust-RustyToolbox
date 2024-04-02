const cp = require("child_process");
const vdf = require('vdf');
const util = require('util');
const exec = util.promisify(cp.exec);

module.exports.getBuildID = async function(appID, branch) {
  // Validate appID or sanitize input here
  try {
    // Attempt to delete the cache file, log errors if any
    await exec('del steam\\appcache\\appinfo.vdf').catch(console.error);
    const { stdout } = await exec(`steam\\steamcmd +login anonymous +app_info_update +app_info_print "${appID}" +logoff +quit`);
    
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
  }
}

var cp  = require("child_process");
var vdf = require('vdf');

module.exports.getBuildID = function(appID, branch) {
  return new Promise(function(resolve, reject) {
    //  First remove the old app db. sometime even using +update 1 on
    //  steamcmd doesn't actually pull fresh API buildid data, so just delete the db..
    cp.exec('del steam\\appcache\\appinfo.vdf',
      function(error, data) {
    });
  cp.exec('steam\\steamcmd +login anonymous +app_info_update +app_info_print "' + appID + '" +logoff +quit',
      function(error, data) {
        const startPattern = `"${appID}"`;
        const endPattern = `steamcmd has been disconnected`;
        const startIndex = data.indexOf(startPattern);
        const endIndex = data.lastIndexOf(endPattern);
        const vdfContent = data.substring(startIndex, endIndex);
        appInfo = vdf.parse(vdfContent);
        buildid = appInfo[appID]?.depots?.branches?.[branch]?.buildid;
        resolve(buildid);
    });
  })
}

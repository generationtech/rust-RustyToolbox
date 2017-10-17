var cp  = require("child_process");
var vdf = require('vdf');

module.exports.getBuildID = function(appID, branch) {
  return new Promise(function(resolve, reject) {
    // First remove the old app db. sometime even using +update 1 on
    // steamcmd doesn't actually pull fresh API buildid data, so just delete the db..
    cp.exec('del steam\\appcache\\appinfo.vdf',
      function(error, data) {
    });
    // steamcmd has problem with stdout and redirection in general where output is truncated.
    // Must run app_info_print twice to get full output from full run, then must remove the
    // the extra half at the end ourselves
    cp.exec('steam\\steamcmd +login anonymous +app_info_print "' + appID + '" +app_info_print "' + appID + '" +quit',
      function(error, data) {
        // cut the junk from front of return data
        var dStart = data.search('"' + appID + '"');
        // cut the extra 0.5 result from data
        data = data.substring(dStart, data.lastIndexOf('AppID : ' + appID));
        // convert Valve Value Data Format to JS object
        data = vdf.parse(data);
        resolve(data[appID]['depots']['branches'][branch]['buildid']);
    });
  })
}

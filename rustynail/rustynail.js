#!/usr/bin/env node
'use strict';

var fs        = require('fs');
var vdf       = require('vdf');
var program   = require('commander');
var branchapi = require('../rustybranch/branchapi');

var defaults = {
      appid:        `258550`,
      manifestFile: `appmanifest_258550.acf`,
      manifestDir:  `C:\\Server\\rustds\\steamapps`,
//      timer:        60000,
      timer:        3000,
    };

var manifestFile;
var timer;

program
  .version('0.3.0')
  .usage('[options]')
  .option('-m, --manifest <directory>', `directory containing ${defaults.manifestFile}, defaults to ${defaults.manifestDir}`)
  .option('-t, --timer <directory>', `check loop timer, defaults to ${defaults.timer}`)
  .parse(process.argv);

manifestFile = program.manifest ? program.manifest + '\\' + defaults.manifestFile : defaults.manifestDir + '\\' + defaults.manifestFile;
timer        = program.timer    ? program.timer : defaults.timer;

function readManifest(file) {
  return new Promise(function(resolve, reject) {
    var data = '';
    var readStream = fs.createReadStream(file, 'utf8');
    readStream.on('data', function(chunk) {
      data += chunk;
    }).on('end', function() {
      let manifest = vdf.parse(data);
      resolve({ 'buildid': manifest['AppState']['buildid'], 'branch': manifest['AppState']['UserConfig']['betakey'] });
    });
  });
}

var flagRunning = true;

(async ()=> {
  var rustBuildid;
  var rustBranch;
  var steamBuildid;

  while (flagRunning) {
      try {
        let retval  = await readManifest(manifestFile);
        rustBuildid = retval['buildid'];
        rustBranch  = retval['branch'];
        if (!rustBranch) rustBranch = "public";
        console.log(`Server: ${rustBuildid}`);
      } catch(e) {
        console.log(e)
      }

      try {
        steamBuildid = await branchapi.getBuildID(defaults.appid, rustBranch);
        console.log(`Steam:  ${steamBuildid}`);
      } catch(e) {
        console.log(e)
      }

      if (rustBuildid != steamBuildid) {
        // initiate server update process
        flagRunning = false;
      }

      console.log('before wait');
      await new Promise((resolve, reject) => setTimeout(() => resolve(), timer));
      console.log('after wait');

  }
  process.exit(0);
})();

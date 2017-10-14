#!/usr/bin/env node
'use strict';

var fs        = require('fs');
var vdf       = require('vdf');
var program   = require('commander');
var branchapi = require('../rustybranch/branchapi');

var appid        = '258550';
var manifestFile = 'appmanifest_258550.acf';
var manifestDir  = 'C:\\Server\\rustds\\steamapps';

program
  .version('0.2.0')
  .usage('[options]')
  .option('-m, --manifest <directory>', `directory containing ${manifestFile}, defaults to ${manifestDir}`)
  .parse(process.argv);

manifestFile = program.manifest   ? program.manifest + '\\' + manifestFile : manifestDir + '\\' + manifestFile;

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

(async ()=> {
  var rustBuildid;
  var rustBranch;
  var steamBuildid;

  try{
    let retval  = await readManifest(manifestFile);
    rustBuildid = retval['buildid'];
    rustBranch  = retval['branch'];
    if (!rustBranch) rustBranch = "public";
    console.log(`Server: ${rustBuildid}`);
  } catch(e) {
    console.log(e)
  }
  try{
    steamBuildid = await branchapi.getBuildID(appid, rustBranch);
    console.log(`Steam:  ${steamBuildid}`);
  } catch(e) {
    console.log(e)
  }
})();

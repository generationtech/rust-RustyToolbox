#!/usr/bin/env node
'use strict';

var fs      = require('fs');
var vdf     = require('vdf');
var program = require('commander');

var appid        = '258550';
var manifestFile = 'appmanifest_258550.acf';
var manifestDir  = 'C:\\Server\\rustds\\steamapps';

program
  .version('0.1.0')
  .usage('[options]')
  .option('-m, --manifest <directory>', `directory containing ${manifestFile}, defaults to ${manifestDir}`)
  .parse(process.argv);

manifestFile   = program.manifest   ? program.manifest + '\\' + manifestFile : manifestDir + '\\' + manifestFile;

function readManifest(file) {
  return new Promise(function(resolve, reject) {
    var data = '';
    var readStream = fs.createReadStream(file, 'utf8');
    readStream.on('data', function(chunk) {
        data += chunk;
    }).on('end', function() {

//        data = vdf.parse(data);
//resolve(data['AppState']['buildid']);
      resolve(vdf.parse(data)['AppState']['buildid']);
        //console.log(data);
        //resolve(data);
    });
  });

}


(async ()=>{
    try{
      //await readManifest('my-file.txt');
      var data1 = await readManifest(manifestFile);
      console.log(data1);
    } catch(e) {
      console.log(e)
    }
})();


//console.log(data1);

//console.log('hello');

#!/usr/bin/env node
'use strict';

const program = require('commander');
const branchAPI = require('./branchapi');

let appID = '258550'; // Default to Rust Dedicated Server
let branch = 'public'; // Default branch

program
  .version('0.3.0')
  .usage('[options]')
  .option('-s, --server', 'fetch dedicated server buildid (default)')
  .option('-c, --client', 'fetch client application buildid')
  .option('-b, --branch <name>', 'branch checked', 'public') // Default value set directly
  .parse(process.argv);

if (program.server && program.client) {
  console.error('Choose either server or client to check buildid, not both.');
  program.help(); // Output help and exit
} else {
  if (program.client) {
    appID = '252490'; // Rust Client Application ID
  }
  branch = program.branch; // No need to check if program.branch exists due to commander's default
}

(async () => {
  try {
    const buildID = await branchAPI.getBuildID(appID, branch);
    console.log(buildID || 'No build ID found for the specified appID and branch.');
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
})();

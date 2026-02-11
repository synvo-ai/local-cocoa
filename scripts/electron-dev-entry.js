const path = require('path');
const { app } = require('electron');

// Enable source map support for better debugging
require('source-map-support').install({
    hookRequire: true
});

const rootDir = path.resolve(__dirname, '..');

if (process.platform === 'darwin') {
    app.setName('Local Cocoa');
}

process.env.TS_NODE_PROJECT = path.join(rootDir, 'src', 'main', 'tsconfig.json');

// Register ts-node with source map support and inline maps for better debugging
require('ts-node').register({
    project: process.env.TS_NODE_PROJECT,
    transpileOnly: true,
    preferTsExts: true,
    compilerOptions: {
        inlineSourceMap: true,
        inlineSources: true
    }
});

// Below added for plugins so that they can import from local-cocoa/src using @ instead of relative paths
// TODO: Isolate plugins completely from main and remove this part
const tsConfig = require('../tsconfig.json');
const tsConfigPaths = require('tsconfig-paths');

tsConfigPaths.register({
    baseUrl: rootDir,      // Ensure this points to where src is
    paths: tsConfig.compilerOptions.paths
});

require('../src/main/main.ts');


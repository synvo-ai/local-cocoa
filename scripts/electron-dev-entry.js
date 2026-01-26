const path = require('path');
const { app } = require('electron');
const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');

const rootDir = path.resolve(__dirname, '..');

if (process.platform === 'darwin') {
    app.setName('Local Cocoa');
}

process.env.TS_NODE_PROJECT = path.join(rootDir, 'src', 'main', 'tsconfig.json');
require('ts-node/register/transpile-only');
require('../src/main/main.ts');

#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const entrypoint = path.join(__dirname, '..', 'dist', 'index.js');
const args = ['--experimental-specifier-resolution=node', entrypoint, ...process.argv.slice(2)];

const child = spawn(process.execPath, args, { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('Failed to start copilot-telegram-bot:', error.message);
  process.exit(1);
});

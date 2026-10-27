'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function buildComputerControl(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.platform !== 'darwin') throw new Error('Build the macOS native control helper on a Mac with Xcode command-line tools.');
  const arch = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : null;
  if (!arch) throw new Error('Computer control supports macOS arm64 and x64 builds.');
  const output = path.join(__dirname, 'native/bin', `mira-control-${arch}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos14.0`, path.join(__dirname, 'native/miraControl.swift'), '-o', output], { stdio: 'inherit' });
  fs.chmodSync(output, 0o755);
};

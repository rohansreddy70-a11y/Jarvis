// Entry point: checks the Node.js version before loading anything that needs
// newer features (node:sqlite), so an old Node gives a clear message.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`\n[jarvis] JARVIS needs Node.js 22.5 or newer — you have ${process.versions.node}.`);
  console.error('[jarvis] Install the current LTS version from https://nodejs.org, then close and reopen this window.\n');
  process.exit(1);
}
await import('./index.js');

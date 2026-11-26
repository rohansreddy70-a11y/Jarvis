import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, loadEnvFile } from '../server/config.js';

test('project root resolves correctly (works with Windows drive letters)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'package.json')));
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'index.html')));
  // The old approach (URL.pathname) yields "/C:/..." on Windows; fileURLToPath does not.
  const winUrl = 'file:///C:/Users/me/Jarvis/server/config.js';
  assert.equal(new URL(winUrl).pathname, '/C:/Users/me/Jarvis/server/config.js');
  assert.equal(fileURLToPath(winUrl, { windows: true }), 'C:\\Users\\me\\Jarvis\\server\\config.js');
  assert.equal(fileURLToPath(pathToFileURL(ROOT)), ROOT);
});

test('missing .env gives a helpful hint, including the Notepad ".env.txt" case', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-env-'));
  const env = path.join(dir, '.env');
  assert.match(loadEnvFile(env), /No \.env file found/);
  fs.writeFileSync(`${env}.txt`, 'X=1');
  assert.match(loadEnvFile(env), /Rename it to "\.env"/);
});

test('Windows launcher uses CRLF line endings', () => {
  const cmd = fs.readFileSync(path.join(ROOT, 'start-jarvis.cmd'), 'utf8');
  assert.ok(cmd.includes('\r\n') && !/[^\r]\n/.test(cmd));
});

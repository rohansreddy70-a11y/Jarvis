import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, publicStatus } from '../server/config.js';

test('public status never contains the API key', () => {
  const cfg = buildConfig({ GROQ_API_KEY: 'gsk_supersecretvalue1234567890', JARVIS_DB_PATH: ':memory:' });
  assert.equal(cfg.ai.configured, true);
  assert.equal(cfg.ai.model, 'llama-3.3-70b-versatile');
  assert.ok(!JSON.stringify(publicStatus(cfg)).includes('gsk_'));
});

test('missing key is reported by variable name', () => {
  const cfg = buildConfig({ AI_PROVIDER: 'openai', JARVIS_DB_PATH: ':memory:' });
  assert.equal(cfg.ai.configured, false);
  assert.deepEqual(cfg.ai.missing, ['OPENAI_API_KEY']);
});

test('refuses to bind to a network interface without an access token', () => {
  const cfg = buildConfig({ JARVIS_HOST: '0.0.0.0', JARVIS_DB_PATH: ':memory:' });
  assert.ok(cfg.errors.some((e) => /JARVIS_ACCESS_TOKEN/.test(e)));
});

test('invalid time zone falls back to UTC with a warning', () => {
  const cfg = buildConfig({ JARVIS_TIMEZONE: 'Mars/Olympus', JARVIS_DB_PATH: ':memory:' });
  assert.equal(cfg.timezone, 'UTC');
  assert.equal(cfg.warnings.length, 1);
});

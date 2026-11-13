import { buildConfig } from '../server/config.js';
import { createApp } from '../server/app.js';

export function testConfig(overrides = {}) {
  return buildConfig({ JARVIS_DB_PATH: ':memory:', JARVIS_TIMEZONE: 'UTC', AI_PROVIDER: 'groq', GROQ_API_KEY: 'test-key', ...overrides });
}

// Scripted stand-in for a model: each call returns the next scripted reply.
// Used only in tests to exercise the tool-calling loop deterministically.
export function scriptedProvider(script) {
  const calls = [];
  return {
    label: 'scripted', model: 'scripted', calls,
    async chat(req) {
      calls.push(req);
      const next = script.shift();
      if (!next) throw new Error('scripted provider exhausted');
      return typeof next === 'function' ? next(req) : next;
    },
  };
}

export const toolCall = (name, args, id = `call_${Math.random().toString(36).slice(2, 8)}`) => ({
  content: '',
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

export function makeApp(script = [], configOverrides) {
  const provider = scriptedProvider(script);
  const app = createApp(testConfig(configOverrides), { provider });
  return { app, provider };
}

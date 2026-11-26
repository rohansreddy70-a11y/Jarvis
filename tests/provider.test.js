import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompatibleProvider } from '../server/ai/provider.js';

// Fake OpenAI-compatible API where only some models exist (test-only).
function fakeApi(available) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push(String(url));
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (String(url).endsWith('/models')) return json({ data: [...available, 'whisper-large-v3'].map((id) => ({ id })) });
    const { model } = JSON.parse(init.body);
    if (!available.includes(model)) return json({ error: { message: `The model \`${model}\` does not exist or you do not have access to it.` } }, 404);
    return json({ choices: [{ message: { content: `hi from ${model}` } }] });
  };
  fn.calls = calls;
  return fn;
}

test('retired default model: switches to an available tool-capable model', async () => {
  const changes = [];
  const p = createOpenAICompatibleProvider({
    baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'llama-3.3-70b-versatile', label: 'Groq',
    fetchImpl: fakeApi(['qwen/qwen3-32b', 'llama-3.1-8b-instant']), autoSelectModel: true,
    onModelChange: (from, to) => changes.push([from, to]),
  });
  const r = await p.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.content, 'hi from qwen/qwen3-32b');
  assert.deepEqual(changes, [['llama-3.3-70b-versatile', 'qwen/qwen3-32b']]);
  assert.equal(p.model, 'qwen/qwen3-32b', 'remembers the working model');
});

test('model chosen by the user is not silently replaced; error lists usable models', async () => {
  const p = createOpenAICompatibleProvider({
    baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'my-typo-model', label: 'Groq',
    fetchImpl: fakeApi(['openai/gpt-oss-120b', 'qwen/qwen3-32b']), autoSelectModel: false,
  });
  await assert.rejects(p.chat({ messages: [] }), (err) => {
    assert.match(err.message, /model "my-typo-model" is not available/);
    assert.match(err.message, /AI_MODEL/);
    assert.match(err.message, /openai\/gpt-oss-120b, qwen\/qwen3-32b/);
    assert.ok(!/whisper/.test(err.message), 'non-chat models are not suggested');
    return true;
  });
});

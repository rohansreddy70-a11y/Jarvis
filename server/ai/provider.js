// Provider abstraction. Every provider exposes:
//   chat({ messages, tools }) -> { content, tool_calls }
// Groq, OpenAI and local servers (Ollama, LM Studio, vLLM) all speak the
// OpenAI Chat Completions format, so one client covers them. To add a
// different API, implement the same `chat` signature and register it below.

export class ProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

// Tool-capable models to try, best first, when the configured default is
// unavailable (providers retire models over time).
export const PREFERRED_MODELS = [
  'openai/gpt-oss-120b',
  'moonshotai/kimi-k2-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.3-70b-versatile',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-20b',
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'llama-3.1-8b-instant',
];
const NOT_CHAT = /whisper|tts|guard|embed|playai|orpheus|distil|compound|vision-only|moderation|dall-e|audio|realtime|transcribe/i;

export function createOpenAICompatibleProvider({ baseUrl, apiKey, model, label = 'AI provider', timeoutMs = 60_000, fetchImpl = fetch, autoSelectModel = false, onModelChange }) {
  const root = baseUrl.replace(/\/$/, '');
  const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  async function listModels() {
    try {
      const res = await fetchImpl(`${root}/models`, { headers: auth, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data?.data || []).map((m) => m.id).filter((id) => typeof id === 'string' && !NOT_CHAT.test(id)).sort();
    } catch {
      return [];
    }
  }

  const provider = {
    label,
    model,
    async chat(req) {
      try {
        return await send(req);
      } catch (err) {
        if (!err.modelUnavailable) throw err;
        const available = await listModels();
        const pick = autoSelectModel && PREFERRED_MODELS.find((m) => m !== provider.model && available.includes(m));
        if (pick) {
          const previous = provider.model;
          provider.model = pick;
          onModelChange?.(previous, pick);
          return send(req);
        }
        const hint = available.length
          ? ` Set AI_MODEL in your .env file to one your account can use, e.g. ${available.slice(0, 8).join(', ')}.`
          : ' Set AI_MODEL in your .env file to a model your account can use.';
        throw new ProviderError(`${label} model "${provider.model}" is not available.${hint}`);
      }
    },
  };

  async function send({ messages, tools }) {
    const model = provider.model;
    const body = { model, messages, temperature: 0.3 };
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    let res;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
      throw new ProviderError(`${label} ${reason}. Check your network connection and AI_BASE_URL.`);
    }
    if (!res.ok) {
      // Never echo the request (it carries the key). Only surface a short error.
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.error?.message ? `: ${String(j.error.message).slice(0, 300)}` : '';
      } catch { /* ignore */ }
      if (res.status === 401 || res.status === 403) throw new ProviderError(`${label} rejected the API key (HTTP ${res.status}). Check the key in your .env file.`, 502);
      if ((res.status === 404 || res.status === 400) && /model/i.test(detail) && /(not exist|not found|decommissioned|no access|do not have access|not supported|deprecated)/i.test(detail)) {
        const err = new ProviderError(`${label} returned HTTP ${res.status}${detail}`);
        err.modelUnavailable = true;
        throw err;
      }
      if (res.status === 429) throw new ProviderError(`${label} rate limit reached. Try again shortly.`, 503);
      throw new ProviderError(`${label} returned HTTP ${res.status}${detail}`);
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new ProviderError(`${label} returned an empty response.`);
    return { content: msg.content || '', tool_calls: msg.tool_calls || [] };
  }

  return provider;
}

// Speech-to-text via the OpenAI-compatible /audio/transcriptions endpoint
// (Groq: whisper-large-v3-turbo, OpenAI: whisper-1). Used for WhatsApp voice notes.
const STT_MODELS = { groq: 'whisper-large-v3-turbo', openai: 'whisper-1' };

export function createTranscriber(config, { fetchImpl = fetch } = {}) {
  const model = config.env.AI_TRANSCRIBE_MODEL || STT_MODELS[config.ai.provider];
  if (!config.ai.configured || !model) return null;
  return {
    model,
    async transcribe(buffer, { filename = 'audio.ogg', mime = 'audio/ogg' } = {}) {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mime }), filename);
      form.append('model', model);
      let res;
      try {
        res = await fetchImpl(`${config.ai.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
          method: 'POST',
          headers: config.ai.apiKey ? { Authorization: `Bearer ${config.ai.apiKey}` } : {},
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new ProviderError(`${config.ai.label} transcription could not be reached.`);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ProviderError(`${config.ai.label} transcription failed (HTTP ${res.status}).`);
      return String(data.text || '').trim();
    },
  };
}

export function createProviderFromConfig(config) {
  if (!config.ai.configured) return null;
  return createOpenAICompatibleProvider({
    baseUrl: config.ai.baseUrl,
    apiKey: config.ai.apiKey,
    model: config.ai.model,
    label: config.ai.label,
    // Only switch automatically when the user didn't choose a model themselves.
    autoSelectModel: !config.env.AI_MODEL,
    onModelChange: (from, to) => {
      config.ai.model = to;
      console.warn(`[jarvis] Model "${from}" is not available on your ${config.ai.label} account; using "${to}" instead. Set AI_MODEL in .env to choose a different one.`);
    },
  });
}

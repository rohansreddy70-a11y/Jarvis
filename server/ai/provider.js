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

export function createOpenAICompatibleProvider({ baseUrl, apiKey, model, label = 'AI provider', timeoutMs = 60_000, fetchImpl = fetch }) {
  return {
    label,
    model,
    async chat({ messages, tools }) {
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
        if (res.status === 429) throw new ProviderError(`${label} rate limit reached. Try again shortly.`, 503);
        throw new ProviderError(`${label} returned HTTP ${res.status}${detail}`);
      }
      const data = await res.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new ProviderError(`${label} returned an empty response.`);
      return { content: msg.content || '', tool_calls: msg.tool_calls || [] };
    },
  };
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
  });
}

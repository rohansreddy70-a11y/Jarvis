// Central configuration. Reads environment variables (optionally from .env),
// validates them, and exposes a *redacted* status view for the UI.
// Secrets never leave this module except to the provider client that needs them.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function loadEnvFile(file = path.join(ROOT, '.env')) {
  if (fs.existsSync(file) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(file);
  }
}

export const PROVIDER_PRESETS = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyVar: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyVar: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
  openai_compatible: {
    label: 'OpenAI-compatible',
    baseUrl: null, // from AI_BASE_URL
    keyVar: 'AI_API_KEY',
    defaultModel: null,
  },
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function buildConfig(env = process.env) {
  const errors = [];
  const warnings = [];

  const host = env.JARVIS_HOST || '127.0.0.1';
  const port = Number(env.JARVIS_PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('JARVIS_PORT must be a valid port number.');

  const accessToken = env.JARVIS_ACCESS_TOKEN || '';
  if (!LOOPBACK.has(host) && !accessToken) {
    errors.push(`JARVIS_HOST is ${host} (not loopback) but JARVIS_ACCESS_TOKEN is empty. Set a token before exposing JARVIS on a network.`);
  }
  if (accessToken && accessToken.length < 16) warnings.push('JARVIS_ACCESS_TOKEN is short; use at least 32 random characters.');

  let timezone = env.JARVIS_TIMEZONE || 'UTC';
  if (!isValidTimeZone(timezone)) {
    warnings.push(`JARVIS_TIMEZONE "${timezone}" is not a valid IANA time zone; falling back to UTC.`);
    timezone = 'UTC';
  }

  const providerId = (env.AI_PROVIDER || 'groq').toLowerCase();
  const preset = PROVIDER_PRESETS[providerId];
  let ai;
  if (!preset) {
    errors.push(`AI_PROVIDER "${providerId}" is not supported. Use one of: ${Object.keys(PROVIDER_PRESETS).join(', ')}.`);
    ai = { provider: providerId, configured: false, missing: ['AI_PROVIDER'] };
  } else {
    const apiKey = env[preset.keyVar] || '';
    const baseUrl = preset.baseUrl || env.AI_BASE_URL || '';
    const model = env.AI_MODEL || preset.defaultModel || '';
    const missing = [];
    // A local openai_compatible server may legitimately need no key.
    if (!apiKey && providerId !== 'openai_compatible') missing.push(preset.keyVar);
    if (!baseUrl) missing.push('AI_BASE_URL');
    if (!model) missing.push('AI_MODEL');
    ai = {
      provider: providerId,
      label: preset.label,
      baseUrl,
      model,
      apiKey, // private: never serialized by publicStatus()
      configured: missing.length === 0,
      missing,
    };
  }

  const dbPath = env.JARVIS_DB_PATH || path.join(ROOT, 'data', 'jarvis.db');

  return {
    root: ROOT,
    host,
    port,
    accessToken,
    timezone,
    userName: env.JARVIS_USER_NAME || '',
    dbPath: dbPath === ':memory:' ? dbPath : path.resolve(ROOT, dbPath),
    ai,
    env, // used only by the integrations registry to check presence of vars
    errors,
    warnings,
  };
}

// Status safe to send to the browser: presence flags only, never values.
export function publicStatus(config) {
  return {
    timezone: config.timezone,
    userName: config.userName,
    authRequired: Boolean(config.accessToken),
    ai: {
      provider: config.ai.provider,
      label: config.ai.label,
      model: config.ai.model || null,
      configured: config.ai.configured,
      missing: config.ai.missing,
    },
    warnings: config.warnings,
  };
}

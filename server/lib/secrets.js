// Detects and redacts credential-like strings so they are never stored in
// memory, written to the activity log, or echoed back to the UI.
const PATTERNS = [
  /\bgsk_[A-Za-z0-9]{20,}\b/g, // Groq
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI / Anthropic
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:password|passwd|pwd|secret|api[_ -]?key|token)\s*[:=]\s*\S+/gi,
];

export function containsSecret(text) {
  if (typeof text !== 'string') return false;
  return PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

export function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

export function redactDeep(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]));
  }
  return value;
}

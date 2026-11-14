// Masks values that look like secrets before logs are stored (Non-functional: Privacy).
// Best effort: clients must still not log secrets.

const PATTERNS: RegExp[] = [
  /\bam_[a-z0-9]{8,}_[A-Za-z0-9_-]{16,}\b/g, // Agent Manager Deluxe machine keys
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // sk-... API keys (Anthropic, OpenAI and others)
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /\bAccountKey=[A-Za-z0-9+/=]{20,}/g, // Azure storage connection strings
];

// "Bearer abc" and "Basic abc": keep the scheme, mask the credential.
const AUTH_SCHEME = /\b(Bearer|Basic)\s+(?!\[masked\])[^\s"'&,;]{6,}/gi;

// "password=abc", "api_key: abc" and similar: keep the label, mask the value.
// The value can't be an auth scheme, which AUTH_SCHEME already handled.
const LABELLED =
  /\b(authorization|password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)(["']?\s*[:=]\s*["']?)(?!(?:bearer|basic)\b|\[masked\])([^\s"'&,;]{6,})/gi;

export function maskSecrets(text: string): string {
  let out = text;
  for (const p of PATTERNS) out = out.replace(p, '[masked]');
  out = out.replace(AUTH_SCHEME, (_m, scheme: string) => `${scheme} [masked]`);
  return out.replace(LABELLED, (_m, label: string, sep: string) => `${label}${sep}[masked]`);
}

/** Masks every string inside a JSON-like value. */
export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskSecrets(value) as T;
  if (Array.isArray(value)) return value.map(maskDeep) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskDeep(v);
    return out as T;
  }
  return value;
}

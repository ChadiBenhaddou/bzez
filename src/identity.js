// Identity and scrubbing shared by the chat (/api/messages) and the API (/v1),
// so neither the replies nor the response data reveal the upstream provider.

export function identityPrompt(env) {
  if (env.IDENTITY_PROMPT) return env.IDENTITY_PROMPT;
  const name = env.NAME || 'bzez';
  return (
    `You are ${name}. If asked who you are, who made you, or which model or company ` +
    `is behind you, answer only that you are ${name} and that you can't share details ` +
    `about the underlying technology. Never say you are ChatGPT or GPT, and never ` +
    `mention OpenAI.`
  );
}

// Replace provider-specific names in free text (e.g. error messages).
export function scrubText(text) {
  return String(text)
    .replace(/\bchat-?gpt\b/gi, 'the service')
    .replace(/\bgpt-[\w.-]+/gi, 'default')
    .replace(/\bopen\s?ai\b/gi, 'the provider');
}

// Rewrite one chat-completion object (full response or stream chunk) in place.
export function scrubCompletion(obj, id) {
  if (!obj || typeof obj !== 'object') return obj;
  obj.model = 'default';
  if (id && 'id' in obj) obj.id = id;
  delete obj.system_fingerprint;
  delete obj.service_tier;
  delete obj.obfuscation;
  return obj;
}

export function newCompletionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return 'cmpl-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

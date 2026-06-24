// Cross-provider sanitizer for user-controlled strings that flow into
// LLM prompts. Defends against:
//   - newlines / control chars breaking prompt structure
//   - embedded double-quotes terminating a JSON example block
//   - unbounded length inflating token cost / blowing context window
//
// Provider-specific prompt builders import this; the sanitizer itself
// is provider-agnostic (it doesn't know about Perplexity or DeepSeek).

export function sanitizeForPrompt(
  value: string | undefined,
  maxLen = 200,
): string {
  if (!value) return "";
  return value
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .trim()
    .slice(0, maxLen);
}

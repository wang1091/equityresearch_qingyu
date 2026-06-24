import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveClassifierLlm } from "../../agent/classifier";

// Offline guard for the registrable classifier LLM endpoint. The point of the
// env override is to let a local OpenAI-compatible model (Ollama/LM Studio)
// stand in for DeepSeek so the routing suite runs for free — without changing
// the default DeepSeek behaviour when the env is unset.
const ENV_KEYS = [
  "CLASSIFIER_LLM_BASE_URL",
  "CLASSIFIER_LLM_MODEL",
  "CLASSIFIER_LLM_API_KEY",
  "CLASSIFIER_LLM_MAX_TOKENS",
  "CLASSIFIER_LLM_TIMEOUT_MS",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_API_KEY",
  "LLM_MAX_TOKENS",
  "LLM_TIMEOUT_MS",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveClassifierLlm", () => {
  it("defaults to hosted DeepSeek (no behaviour change when env unset)", () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const llm = resolveClassifierLlm();
    expect(llm.baseUrl).toBe("https://api.deepseek.com");
    expect(llm.model).toBe("deepseek-chat");
    expect(llm.apiKey).toBe("sk-test");
    expect(llm.maxTokens).toBe(1000);
    expect(llm.timeoutMs).toBe(15000);
    expect(llm.isDefaultDeepSeek).toBe(true);
  });

  it("honors CLASSIFIER_LLM_MAX_TOKENS, ignoring invalid values", () => {
    process.env.CLASSIFIER_LLM_MAX_TOKENS = "4000";
    expect(resolveClassifierLlm().maxTokens).toBe(4000);
    process.env.CLASSIFIER_LLM_MAX_TOKENS = "abc";
    expect(resolveClassifierLlm().maxTokens).toBe(1000);
  });

  it("honors CLASSIFIER_LLM_TIMEOUT_MS for slow local models", () => {
    process.env.CLASSIFIER_LLM_TIMEOUT_MS = "60000";
    expect(resolveClassifierLlm().timeoutMs).toBe(60000);
    process.env.CLASSIFIER_LLM_TIMEOUT_MS = "";
    expect(resolveClassifierLlm().timeoutMs).toBe(15000);
  });

  it("points at a local OpenAI-compatible endpoint, keyless", () => {
    process.env.CLASSIFIER_LLM_BASE_URL = "http://localhost:11434/v1/";
    process.env.CLASSIFIER_LLM_MODEL = "qwen2.5:14b";
    const llm = resolveClassifierLlm();
    expect(llm.baseUrl).toBe("http://localhost:11434/v1"); // trailing slash trimmed
    expect(llm.model).toBe("qwen2.5:14b");
    expect(llm.apiKey).toBe(""); // local server runs keyless
    expect(llm.isDefaultDeepSeek).toBe(false);
  });

  it("honors the generic LLM_* aliases", () => {
    process.env.LLM_BASE_URL = "http://localhost:1234/v1";
    process.env.LLM_MODEL = "local-model";
    process.env.LLM_API_KEY = "lm-studio";
    const llm = resolveClassifierLlm();
    expect(llm.baseUrl).toBe("http://localhost:1234/v1");
    expect(llm.model).toBe("local-model");
    expect(llm.apiKey).toBe("lm-studio");
    expect(llm.isDefaultDeepSeek).toBe(false);
  });

  it("prefers the CLASSIFIER_LLM_* vars over the generic aliases", () => {
    process.env.CLASSIFIER_LLM_BASE_URL = "http://specific:11434/v1";
    process.env.LLM_BASE_URL = "http://generic:1234/v1";
    expect(resolveClassifierLlm().baseUrl).toBe("http://specific:11434/v1");
  });
});

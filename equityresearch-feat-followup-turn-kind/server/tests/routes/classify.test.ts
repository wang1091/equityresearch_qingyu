// L2 behavior net for /classify-intents-multi. Validates input, requires a
// DeepSeek key, delegates to classifyIntents (mocked here), and falls back to
// buildKeywordFallback on error. Stubs env + mocks the classifier module.
//
// Run green against the inline code before extracting classify/* out of
// routes.ts; must stay green after the move.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerRoutes } from "../../routes";
import { classifyIntents, buildKeywordFallback, resolveClassifierLlm } from "../../agent/classifier";

vi.mock("../../agent/classifier", () => ({
  classifyIntents: vi.fn(),
  buildKeywordFallback: vi.fn(() => ({ fallback: true })),
  // Default: classifier would use hosted DeepSeek, so the route's key guard
  // applies. The local-LLM test overrides this to isDefaultDeepSeek: false.
  resolveClassifierLlm: vi.fn(() => ({ isDefaultDeepSeek: true })),
}));

let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /classify-intents-multi (L2)", () => {
  it("rejects a missing query with 400", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "k");
    const res = await request(app).post("/api/classify-intents-multi").send({});
    expect(res.status).toBe(400);
  });

  it("returns 500 when no DeepSeek key is configured (and no local classifier)", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("DEEPSEEK_KEY", "");
    vi.mocked(resolveClassifierLlm).mockReturnValue({ isDefaultDeepSeek: true } as any);
    const res = await request(app).post("/api/classify-intents-multi").send({ query: "buy NVDA?" });
    expect(res.status).toBe(500);
  });

  it("allows a local classifier (CLASSIFIER_LLM_BASE_URL) with no DeepSeek key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("DEEPSEEK_KEY", "");
    vi.mocked(resolveClassifierLlm).mockReturnValue({ isDefaultDeepSeek: false } as any);
    vi.mocked(classifyIntents).mockResolvedValue({ required_data: ["NEWS"] } as any);
    const res = await request(app).post("/api/classify-intents-multi").send({ query: "NVDA news" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ required_data: ["NEWS"] });
  });

  it("delegates to classifyIntents and returns its result", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "k");
    vi.mocked(classifyIntents).mockResolvedValue({ required_data: ["NEWS"] } as any);
    const res = await request(app).post("/api/classify-intents-multi").send({ query: "NVDA news" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ required_data: ["NEWS"] });
  });

  it("falls back to keyword classification when classifyIntents throws", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "k");
    vi.mocked(classifyIntents).mockRejectedValue(new Error("llm down"));
    const res = await request(app).post("/api/classify-intents-multi").send({ query: "NVDA news" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fallback: true });
    expect(vi.mocked(buildKeywordFallback)).toHaveBeenCalled();
  });
});

// L2 behavior net for /follow-ups (the Follow-Up Engine — DeepSeek prompt that
// proposes next research questions). Pins the input guard (400) and the no-key
// guard (503), which are the deterministic contracts that a verbatim move could
// break. The LLM happy path (model-text parsing) is left to the verbatim move +
// tsc + the L1 route-table golden.
//
// Run green against the inline code before extracting followups/* out of
// routes.ts; must stay green after the move.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerRoutes } from "../../routes";

let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /follow-ups (L2)", () => {
  it("requires user_question and agent_answer (400)", async () => {
    const res = await request(app).post("/api/follow-ups").send({ user_question: "is NVDA a buy?" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });

  it("returns 503 when DeepSeek is not configured", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const res = await request(app)
      .post("/api/follow-ups")
      .send({ user_question: "is NVDA a buy?", agent_answer: "It depends on valuation." });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false });
  });
});

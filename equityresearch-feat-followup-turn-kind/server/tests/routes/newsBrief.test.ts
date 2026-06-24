// L2 net for POST /agent/news-brief — the dedicated, non-streaming News Brief
// endpoint that replaced the old "/agent/chat-stream + client-supplied
// classification" path. The intent is known (NEWS_BRIEF), so this endpoint must
// NOT classify or fetch data — it builds the NEWS_BRIEF specialMode server-side
// and calls the generator directly, returning the parsed JSON brief.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const generateAnswerStream = vi.fn();
vi.mock("../../agent/generator", async (orig) => ({
  ...(await orig<typeof import("../../agent/generator")>()),
  generateAnswerStream: (...a: unknown[]) => generateAnswerStream(...a),
}));

import { registerRoutes } from "../../routes";

let app: Express;
beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});
beforeEach(() => generateAnswerStream.mockReset());

describe("POST /agent/news-brief (L2)", () => {
  it("returns the parsed brief; builds NEWS_BRIEF mode server-side, no data fetch", async () => {
    generateAnswerStream.mockResolvedValue(
      '{"summary":"NVDA had a strong week","insights":["momentum"]}',
    );

    const res = await request(app).post("/api/agent/news-brief").send({
      newsContent: "NVDA jumped 10% after earnings...",
      ticker: "NVDA",
      sources: [],
      citations: [],
      language: "en",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      brief: { summary: "NVDA had a strong week", insights: ["momentum"] },
    });

    // server-built specialMode, apiData null (the endpoint never fetches data)
    expect(generateAnswerStream).toHaveBeenCalledTimes(1);
    const args = generateAnswerStream.mock.calls[0];
    expect(args[1]).toBeNull(); // apiData
    expect(args[5]).toMatchObject({
      type: "NEWS_BRIEF",
      context: { newsContent: expect.any(String), ticker: "NVDA" },
    });
  });

  it("400 when newsContent is missing (before any generation)", async () => {
    const res = await request(app).post("/api/agent/news-brief").send({ ticker: "NVDA" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(generateAnswerStream).not.toHaveBeenCalled();
  });

  it("surfaces raw text when the brief is not valid JSON", async () => {
    generateAnswerStream.mockResolvedValue("not json at all");
    const res = await request(app)
      .post("/api/agent/news-brief")
      .send({ newsContent: "x" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, raw: "not json at all" });
  });
});

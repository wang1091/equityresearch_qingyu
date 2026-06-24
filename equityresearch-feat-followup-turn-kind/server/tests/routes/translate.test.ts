// L2 behavior net for /translate-visible-content. Translates string or object
// payloads via the translation service (mocked here). L1 covers the bad-language
// 400; this pins the string vs object dispatch.
//
// Run green against the inline code before extracting translate/* out of
// routes.ts; must stay green after the move.
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerRoutes } from "../../routes";
import { translateTextToLanguage, translateJsonValuesToLanguage } from "../../translation";

vi.mock("../../translation", () => ({
  translateTextToLanguage: vi.fn(),
  translateJsonValuesToLanguage: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

describe("POST /translate-visible-content (L2)", () => {
  it("rejects an invalid targetLanguage with 400", async () => {
    const res = await request(app).post("/api/translate-visible-content").send({ targetLanguage: "fr", payload: "hi" });
    expect(res.status).toBe(400);
  });

  it("translates a string payload via translateTextToLanguage", async () => {
    vi.mocked(translateTextToLanguage).mockResolvedValue("你好");
    const res = await request(app)
      .post("/api/translate-visible-content")
      .send({ targetLanguage: "zh", mode: "html", payload: "hello" });

    expect(res.status).toBe(200);
    expect(vi.mocked(translateTextToLanguage)).toHaveBeenCalledWith("hello", "zh", "html");
  });

  it("translates an object payload via translateJsonValuesToLanguage", async () => {
    vi.mocked(translateJsonValuesToLanguage).mockResolvedValue({ a: "你好" } as any);
    const res = await request(app)
      .post("/api/translate-visible-content")
      .send({ targetLanguage: "zh", payload: { a: "hello" } });

    expect(res.status).toBe(200);
    expect(vi.mocked(translateJsonValuesToLanguage)).toHaveBeenCalled();
  });
});

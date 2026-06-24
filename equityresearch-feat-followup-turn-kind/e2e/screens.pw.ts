import { test, expect, type Page, type Locator } from "@playwright/test";

// Screenshot GALLERY of the frontend's real rendered states. This app has only two
// in-app pages — "/" (the chat assistant) and "/competitive" — but the chat renders
// a different card per query TYPE, so the variety comes from asking different things.
// (The other left-nav items open EXTERNAL sites in new tabs; not this frontend.)
//
// Each query is its own test so they isolate + name their own screenshot. The
// "Copy" action under every real answer is the universal "answer rendered" signal.
// LLM-backed answers are slow on a local model — run a subset with:
//   npm run test:ui -- screens.pw.ts -g "valuation"
const SHOTS = "e2e/__screenshots__";

async function visibleOne(a: Locator, b: Locator): Promise<Locator> {
  return (await a.isVisible().catch(() => false)) ? a : b;
}

async function ask(page: Page, query: string, file: string) {
  await page.goto("/");
  const input = await visibleOne(page.getByTestId("input-message"), page.getByTestId("input-message-bottom"));
  const send = await visibleOne(page.getByTestId("button-send"), page.getByTestId("button-send-bottom"));
  await input.fill(query);
  await send.click();

  let ok = true;
  try {
    // every real answer renders a "Copy" action under the card
    await expect(page.getByText("Copy", { exact: true }).last()).toBeVisible({ timeout: 150_000 });
    await page.waitForTimeout(2500); // let the card finish painting
  } catch {
    ok = false;
  }
  await page.screenshot({ path: `${SHOTS}/${file}.png`, fullPage: true });
  expect(ok, `"${query}" did not render an answer in 150s (local LLM up?)`).toBe(true);
}

test("gallery: stock price card", async ({ page }) => {
  await ask(page, "AAPL stock price today", "g01-stock-price");
});

test("gallery: market data (market cap)", async ({ page }) => {
  await ask(page, "What is NVDA's market cap?", "g02-market-data");
});

test("gallery: valuation card", async ({ page }) => {
  await ask(page, "NVDA valuation", "g03-valuation");
});

test("gallery: news", async ({ page }) => {
  await ask(page, "Apple latest news", "g04-news");
});

test("gallery: stock-picker scorecard (analyze)", async ({ page }) => {
  await ask(page, "analyze nvidia", "g05-stock-picker");
});

test("gallery: investment brief (decision query)", async ({ page }) => {
  await ask(page, "should I buy AAPL?", "g06-investment-brief");
});

test("gallery: /competitive page", async ({ page }) => {
  await page.goto("/competitive");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/g07-competitive-page.png`, fullPage: true });
});

test("gallery: Chinese UI", async ({ page }) => {
  await page.goto("/");
  await page.getByText("中文", { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/g08-chinese-ui.png`, fullPage: true });
});

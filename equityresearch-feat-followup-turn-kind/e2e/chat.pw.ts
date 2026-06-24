import { test, expect, type Locator } from "@playwright/test";

const SHOTS = "e2e/__screenshots__";

// Pick whichever of the two input bars (empty-state vs docked-bottom) is visible.
async function visibleOne(a: Locator, b: Locator): Promise<Locator> {
  if (await a.isVisible().catch(() => false)) return a;
  return b;
}

test("chat UI: ask a stock-price question and render the streamed answer", async ({ page }) => {
  await page.goto("/");
  // 1) initial app shell (welcome + input)
  await page.screenshot({ path: `${SHOTS}/01-initial.png`, fullPage: true });

  const input = await visibleOne(
    page.getByTestId("input-message"),
    page.getByTestId("input-message-bottom"),
  );
  const send = await visibleOne(
    page.getByTestId("button-send"),
    page.getByTestId("button-send-bottom"),
  );

  await input.fill("AAPL stock price today");
  await send.click();

  // user's message is echoed into the thread → submit wired correctly
  await expect(page.getByText("AAPL stock price today").first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/02-submitted.png`, fullPage: true });

  // wait for the assistant's streamed answer. No per-message testid, so use a
  // content heuristic (a price answer shows a "$"). Soft: on timeout we still
  // capture the final screenshot below so the UI is visible either way.
  let answered = true;
  try {
    await expect(page.locator("body")).toContainText("$", { timeout: 120_000 });
    await page.waitForTimeout(3000); // let the stream settle
  } catch {
    answered = false;
  }

  // 3) final rendered state (the answer card, or whatever rendered if it timed out)
  await page.screenshot({ path: `${SHOTS}/03-answer.png`, fullPage: true });

  expect(answered, "assistant answer did not render within 120s (is the local LLM up?)").toBe(true);
});

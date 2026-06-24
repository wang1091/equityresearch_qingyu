import { test, expect, type Page, type Locator } from "@playwright/test";

// Screenshot the rebuilt STOCK_PICKER boxed card (source_card channel). Unlike the
// gallery's "Copy"-action signal, a source_card turn has no action bar, so we wait on
// the card's own CTA testid. The score-off upstream is slow (~45s) and flaky (one
// ticker of a comparison can drop), so allow a long wait and screenshot whatever
// renders — comparison (both tickers) or single + dropped notice both demonstrate it.
const SHOTS = "e2e/__screenshots__";

async function visibleOne(a: Locator, b: Locator): Promise<Locator> {
  return (await a.isVisible().catch(() => false)) ? a : b;
}

test("stock-picker: compare amd and nvidia", async ({ page }) => {
  await page.goto("/");
  const input = await visibleOne(page.getByTestId("input-message"), page.getByTestId("input-message-bottom"));
  const send = await visibleOne(page.getByTestId("button-send"), page.getByTestId("button-send-bottom"));
  await input.fill("compare amd and nvidia");
  await send.click();

  // The picker card always renders the "open Stock Picker" CTA.
  await expect(page.getByTestId("follow-up-stockpicker")).toBeVisible({ timeout: 160_000 });
  await page.waitForTimeout(1500); // let it finish painting
  await page.screenshot({ path: `${SHOTS}/stock-picker-compare.png`, fullPage: true });
});

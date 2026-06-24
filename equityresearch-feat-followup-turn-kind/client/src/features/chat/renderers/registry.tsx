import type { UILanguage } from "@/utils/i18n";
import type { RatingResponse } from "@shared/rating";
import type { StockPriceResponse } from "@shared/stockPrice";
import type { ValuationResponse } from "@shared/valuation";
import type { PerformanceResponse } from "@shared/performance";
import type { FdaResponse } from "@shared/fda";
import type { TrendingResponse } from "@shared/trending";
import type { MarketDataResponse } from "@shared/marketData";
import { RatingCard } from "./RatingCard";
import { StockPriceCard } from "./StockPriceCard";
import { ValuationCard } from "./ValuationCard";
import { PerformanceCard } from "./PerformanceCard";
import { FdaCard } from "./FdaCard";
import { TrendingCard } from "./TrendingCard";
import { MarketDataCard } from "./MarketDataCard";
import { RumorCard } from "./RumorCard";
import { EarningsCard } from "./EarningsCard";
import { CompetitiveResultCard } from "@/components/competitive/CompetitiveResultCard";
import type { SuccessResponse as CompetitiveData } from "@/lib/competitive/types";
import { StockPickerCard } from "./StockPickerCard";
import type { StockPickerCardPayload } from "@shared/stockPicker";

/**
 * Renderer registry for the generic `source_card` channel: source → component.
 * Add a migrated datasource = one entry here + its card component (see
 * docs/CARD_RENDER_MIGRATION_PLAN.md). The payload is typed per source at the
 * registry boundary; <SourceCard> dispatches and casts.
 */
type SourceCardRenderer = (props: { payload: any; uiLanguage: UILanguage }) => JSX.Element;

const SOURCE_CARD_RENDERERS: Record<string, SourceCardRenderer> = {
  RATING: ({ payload, uiLanguage }) => (
    <RatingCard payload={payload as RatingResponse} uiLanguage={uiLanguage} />
  ),
  STOCK_PRICE: ({ payload, uiLanguage }) => (
    <StockPriceCard payload={payload as StockPriceResponse} uiLanguage={uiLanguage} />
  ),
  VALUATION: ({ payload, uiLanguage }) => (
    <ValuationCard payload={payload as ValuationResponse} uiLanguage={uiLanguage} />
  ),
  PERFORMANCE: ({ payload, uiLanguage }) => (
    <PerformanceCard payload={payload as PerformanceResponse} uiLanguage={uiLanguage} />
  ),
  FDA: ({ payload, uiLanguage }) => (
    <FdaCard payload={payload as FdaResponse} uiLanguage={uiLanguage} />
  ),
  TRENDING: ({ payload, uiLanguage }) => (
    <TrendingCard payload={payload as TrendingResponse} uiLanguage={uiLanguage} />
  ),
  MARKET_DATA: ({ payload, uiLanguage }) => (
    <MarketDataCard payload={payload as MarketDataResponse} uiLanguage={uiLanguage} />
  ),
  RUMOR: ({ payload, uiLanguage }) => <RumorCard payload={payload} uiLanguage={uiLanguage} />,
  EARNINGS: ({ payload, uiLanguage }) => <EarningsCard payload={payload} uiLanguage={uiLanguage} />,
  // Folded from the dedicated `competitive` channel onto source_card; reuses the
  // same <CompetitiveResultCard> the /competitive page renders.
  COMPETITIVE: ({ payload, uiLanguage }) => (
    <CompetitiveResultCard data={payload as CompetitiveData} lang={uiLanguage} />
  ),
  STOCK_PICKER: ({ payload, uiLanguage }) => (
    <StockPickerCard payload={payload as StockPickerCardPayload} uiLanguage={uiLanguage} />
  ),
};

/** Render a structured card by source. Returns null for an unregistered source
 *  (the turn then shows nothing extra — backend only emits registered sources). */
export const SourceCard = ({
  cardData,
  uiLanguage,
}: {
  cardData: { source: string; payload: unknown };
  uiLanguage: UILanguage;
}) => {
  const Renderer = SOURCE_CARD_RENDERERS[cardData.source];
  if (!Renderer) return null;
  return <Renderer payload={cardData.payload} uiLanguage={uiLanguage} />;
};

/**
 * Wire contract for the PEER_STOCKS response (server/quotes/service.ts —
 * getPeerStocks). Single source of truth for formatter + simplifier.
 */

export interface PeerStock {
  symbol: string;
  score: number;
}

export interface PeerStocksResponse {
  success: boolean;
  ticker: string;
  similarStocks: PeerStock[];
  count: number;
  timestamp: string;
}

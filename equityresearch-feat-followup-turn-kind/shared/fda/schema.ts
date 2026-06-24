/**
 * Wire contract for the FDA response (server/fda/service.ts — the FDA calendar
 * proxy). Single source of truth for formatter + simplifier.
 */

export interface FdaDrugEvent {
  id?: number;
  drug: string;
  indication: string;
  date: string | null;
  event: string;
  status: string;
  eventDetails: string | null;
}

export interface FdaData {
  company: string;
  ticker: string;
  drugs: FdaDrugEvent[];
  totalEvents: number;
  latestUpdate: string | null;
}

export interface FdaResponse {
  success: boolean;
  data: FdaData;
}

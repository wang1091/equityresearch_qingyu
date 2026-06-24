// Domain model: the language of "competitive analysis" itself. These
// types describe the business object, independent of how it's transported
// (wire format) or who computed it (provider).

export interface Force {
  score: number;
  analysis: string;
}

export interface ForcesObject {
  competitive_rivalry: Force;
  threat_of_new_entrants: Force;
  threat_of_substitutes: Force;
  supplier_power: Force;
  buyer_power: Force;
}

export interface SourceCitation {
  url: string;
  title?: string;
  date?: string;
}

// Single source of truth for Chinese pharma-company name → English-name aliases,
// used to resolve FDA queries (the FDA upstream keys on English company names).
// Previously duplicated verbatim in agent/apiCaller.ts and
// agent/classifier/normalize.ts; consolidated here.
export const FDA_COMPANY_ALIASES: Record<string, string> = {
  "罗氏": "Roche",
  "羅氏": "Roche",
  "辉瑞": "Pfizer",
  "輝瑞": "Pfizer",
  "强生": "Johnson & Johnson",
  "強生": "Johnson & Johnson",
  "默沙东": "Merck",
  "默沙東": "Merck",
  "阿斯利康": "AstraZeneca",
  "诺华": "Novartis",
  "諾華": "Novartis",
  "礼来": "Eli Lilly",
  "禮來": "Eli Lilly",
  "赛诺菲": "Sanofi",
  "賽諾菲": "Sanofi",
};

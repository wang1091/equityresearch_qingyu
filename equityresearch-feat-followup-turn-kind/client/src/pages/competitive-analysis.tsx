import { useState } from "react";
import { LOCAL_API_BASE_URL } from "@/utils/constants";
import {
  type ApiResponse,
  type ErrorResponse,
  type Lang,
  type SuccessResponse,
} from "@/lib/competitive/types";
import { TRANSLATIONS } from "@/lib/competitive/i18n";
import {
  Card,
  CardHeader,
  FormField,
  Spinner,
  inputClass,
} from "@/components/competitive/ui";
import { FrameworkOverview } from "@/components/competitive/FrameworkOverview";
import { CompetitiveResultCard } from "@/components/competitive/CompetitiveResultCard";

const MONO = "'JetBrains Mono', monospace";

const CompetitiveAnalysisPage = () => {
  const [lang, setLang] = useState<Lang>("en");
  const [companyName, setCompanyName] = useState("");
  const [ticker, setTicker] = useState("");
  const [industry, setIndustry] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<SuccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = TRANSLATIONS[lang];

  const toggleLang = () => setLang((prev) => (prev === "en" ? "zh" : "en"));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() && !ticker.trim()) return;

    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(
        `${LOCAL_API_BASE_URL}/api/competitive-analysis`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyName: companyName.trim() || undefined,
            ticker: ticker.trim() || undefined,
            industry: industry.trim() || undefined,
            additionalContext: additionalContext.trim() || undefined,
            // Backend honors "en" and "zh" (bilingual `lang=both` is a
            // documented gap — frontend `pickDisplaySlice` inside
            // CompetitiveResultCard falls back to top-level fields when
            // the `zh` block is absent).
            lang,
          }),
        },
      );

      const data: ApiResponse = await response.json();

      if (!response.ok || !data.success) {
        setError(
          (data as ErrorResponse).error ?? `Server Error (${response.status})`,
        );
        return;
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div
      className="min-h-screen text-[#1a1a1a]"
      style={{
        fontFamily: "'Crimson Pro', Georgia, serif",
        background: "linear-gradient(135deg, #f8fafb 0%, #e8f0f5 100%)",
      }}
    >
      <div className="mx-auto max-w-[1400px] px-4 py-4 md:px-8 md:py-8">
        <header className="mb-8 text-center">
          <div className="mb-6 flex items-center justify-between gap-2">
            <a
              href="/"
              className="text-xs font-semibold uppercase tracking-wider text-[#1a4d7a] transition-colors hover:text-[#00d4aa]"
              style={{ fontFamily: MONO }}
            >
              {t.back}
            </a>
            <button
              onClick={toggleLang}
              className="rounded-md border border-[#e5e7eb] bg-white px-3 py-1.5 text-xs font-semibold text-[#0a2540] shadow-sm transition-colors hover:border-[#00d4aa]"
              style={{ fontFamily: MONO }}
            >
              {t.langSwitch}
            </button>
          </div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[#0a2540] md:text-5xl lg:text-6xl">
            {t.title}
          </h1>
          <p
            className="text-xs uppercase tracking-widest text-[#6b7280] md:text-sm"
            style={{ fontFamily: MONO }}
          >
            {t.subtitle}
          </p>
        </header>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader icon="🎯" title={t.analysisTitle} />
            <form onSubmit={handleSubmit} className="space-y-6">
              <FormField label={t.companyLabel}>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={t.companyPlaceholder}
                  className={inputClass}
                  required={!ticker.trim()}
                />
              </FormField>
              <FormField label={t.tickerLabel}>
                <input
                  type="text"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  placeholder={t.tickerPlaceholder}
                  className={inputClass}
                />
              </FormField>
              <FormField label={t.industryLabel}>
                <input
                  type="text"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder={t.industryPlaceholder}
                  className={inputClass}
                />
              </FormField>
              <FormField label={t.contextLabel}>
                <textarea
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  placeholder={t.contextPlaceholder}
                  className={`${inputClass} min-h-[100px] resize-y`}
                />
              </FormField>
              <button
                type="submit"
                disabled={isAnalyzing}
                className="w-full rounded-lg px-6 py-4 text-sm font-semibold uppercase tracking-wider text-white transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: isAnalyzing
                    ? "linear-gradient(135deg, #00d4aa, #1a4d7a)"
                    : "linear-gradient(135deg, #1a4d7a, #0a2540)",
                  fontFamily: MONO,
                }}
              >
                {isAnalyzing ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Spinner />
                    {t.analyzing}
                  </span>
                ) : (
                  t.analyzeBtn
                )}
              </button>
            </form>
          </Card>

          <FrameworkOverview t={t} />
        </div>

        {error && (
          <div className="mb-8 rounded-lg border border-[#ff6b6b] bg-[#fee] p-4 text-sm text-[#c00]">
            <strong>⚠️ Error: </strong>
            {error}
          </div>
        )}

        {result && <CompetitiveResultCard data={result} lang={lang} />}
      </div>
    </div>
  );
};

export default CompetitiveAnalysisPage;

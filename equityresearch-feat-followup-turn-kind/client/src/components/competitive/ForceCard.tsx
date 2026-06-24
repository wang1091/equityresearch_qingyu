import { SectionLabel } from "./ui";

type Props = {
  label: string;
  score: number;
  analysis: string;
};

// Porter "pressure traffic light" — higher score = more pressure on the firm =
// warmer color. Mirrors the legacy thresholds in cardFormatter.ts so the chat
// surface (which used to render the old HTML card) keeps the same severity
// semantics users have already learned.
//   1-3  low / favorable     → emerald
//   4-6  moderate            → amber
//   7-10 high / cautionary   → red
function scoreColor(score: number): string {
  if (score >= 7) return "#ef4444";
  if (score >= 4) return "#f59e0b";
  return "#10b981";
}

export const ForceCard = ({ label, score, analysis }: Props) => {
  const color = scoreColor(score);
  return (
    <div
      className="rounded-xl border-l-4 p-5 transition-all hover:translate-x-1"
      style={{
        background: "linear-gradient(135deg, #f8fafb 0%, white 100%)",
        borderLeftColor: color,
      }}
    >
      <SectionLabel>{label}</SectionLabel>
      <div className="mb-3 flex items-center gap-4">
        <div
          className="text-3xl font-bold leading-none md:text-4xl"
          style={{ color }}
        >
          {score}
        </div>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#e5e7eb]">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${Math.max(0, Math.min(100, score * 10))}%`,
              background: color,
            }}
          />
        </div>
      </div>
      <div className="text-sm leading-relaxed text-[#6b7280]">{analysis}</div>
    </div>
  );
};

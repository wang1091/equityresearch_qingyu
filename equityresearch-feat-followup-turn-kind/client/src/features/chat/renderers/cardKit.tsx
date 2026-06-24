/**
 * Shared card primitives for the source_card renderers. Every card was hand-rolling
 * its own box/header/metric/section/pill chrome (EarningsCard.Card, TrendingCard.Shell,
 * PerformanceCard.MetricBox, ValuationCard.SectionLabel, …); this consolidates the
 * common pieces so a new card composes them instead of re-deriving Tailwind. Existing
 * cards can migrate onto these incrementally. See docs/CARD_RENDER_MIGRATION_PLAN.md.
 */
import type { ReactNode } from "react";

/** Rounded, bordered, shadowed white box — the outer container every card shares. */
export const CardShell = ({ children }: { children: ReactNode }) => (
  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">{children}</div>
);

/** Gradient title bar. `right` renders a right-aligned block (e.g. price/score). */
export const CardHeader = ({
  icon,
  title,
  sub,
  right,
  gradient = "from-indigo-600 to-purple-600",
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  gradient?: string;
}) => (
  <div className={`bg-gradient-to-br ${gradient} px-5 py-4 text-white`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-bold">
          {icon ? <span className="mr-1">{icon}</span> : null}
          {title}
        </div>
        {sub != null && <div className="mt-1 text-xs opacity-80">{sub}</div>}
      </div>
      {right != null && <div className="flex-shrink-0 text-right">{right}</div>}
    </div>
  </div>
);

/** Uppercase section label + its body. */
export const Section = ({ title, children }: { title: ReactNode; children: ReactNode }) => (
  <div>
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{title}</div>
    {children}
  </div>
);

/** Small label/value tile (key-metrics grids). */
export const MetricBox = ({ label, value }: { label: ReactNode; value: ReactNode }) => (
  <div className="rounded-lg bg-gray-50 p-2.5 text-center">
    <div className="text-[11px] text-gray-500">{label}</div>
    <div className="mt-0.5 text-sm font-semibold text-gray-800">{value}</div>
  </div>
);

type Tone = "pos" | "neg" | "neutral";
const TONE_CLASS: Record<Tone, string> = {
  pos: "bg-emerald-100 text-emerald-800",
  neg: "bg-red-100 text-red-800",
  neutral: "bg-amber-100 text-amber-800",
};

/** Rounded badge. */
export const Pill = ({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) => (
  <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]}`}>{children}</span>
);

/** Tone for a 0–100 score (>=67 good, >=40 mid, else weak). */
export const scoreTone = (v: number): Tone => (v >= 67 ? "pos" : v >= 40 ? "neutral" : "neg");

const BAR_COLOR: Record<Tone, string> = {
  pos: "bg-emerald-500",
  neg: "bg-red-500",
  neutral: "bg-amber-500",
};

/** Horizontal 0–`max` score bar with a right-aligned numeric readout. */
export const ScoreBar = ({ value, max = 100 }: { value: number; max?: number }) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded bg-gray-200">
        <div className={`h-1.5 rounded ${BAR_COLOR[scoreTone((value / max) * 100)]}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-xs font-semibold text-gray-700">{Math.round(value)}</span>
    </div>
  );
};

/** Bulleted list of strings (skips empties); returns null when nothing to show. */
export const Bullets = ({ items, tone }: { items: unknown; tone?: "pos" | "neg" }) => {
  const list = (Array.isArray(items) ? items : []).map(String).filter((s) => s.trim());
  if (list.length === 0) return null;
  const dot = tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-red-500" : "text-gray-400";
  return (
    <ul className="space-y-1">
      {list.map((s, i) => (
        <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-gray-700">
          <span className={dot}>•</span>
          <span className="flex-1">{s}</span>
        </li>
      ))}
    </ul>
  );
};

// One-line legend for the force-score color coding. Colors mirror the
// thresholds in ForceCard.tsx (`scoreColor`) — keep them in sync if either
// side changes. Surfaces the Porter convention: higher score = more pressure
// on the firm (so red is cautionary, not a property judgment of the force).

type Props = {
  caption: string;
  high: string;
  moderate: string;
  low: string;
};

export const PressureLegend = ({ caption, high, moderate, low }: Props) => (
  <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-[#6b7280]">
    <span className="font-medium text-[#4b5563]">{caption}</span>
    <LegendDot color="#ef4444" text={high} />
    <LegendDot color="#f59e0b" text={moderate} />
    <LegendDot color="#10b981" text={low} />
  </div>
);

const LegendDot = ({ color, text }: { color: string; text: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: color }}
      aria-hidden
    />
    {text}
  </span>
);

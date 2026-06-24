import { Card, CardHeader } from "./ui";
import { FORCE_KEYS } from "@/lib/competitive/types";
import type { Translation } from "@/lib/competitive/i18n";

type Props = {
  t: Translation;
};

export const FrameworkOverview = ({ t }: Props) => (
  <Card>
    <CardHeader icon="📊" title={t.overviewTitle} />
    <div className="space-y-3 text-[#6b7280]">
      {FORCE_KEYS.map((key) => (
        <div key={key} className="rounded-lg bg-[#f8fafb] p-5">
          <div className="mb-2 font-semibold text-[#0a2540]">
            {t.forceLabels[key]}
          </div>
          <div className="text-sm">{t.forceDescriptions[key]}</div>
        </div>
      ))}
    </div>
  </Card>
);

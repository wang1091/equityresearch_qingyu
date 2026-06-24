// Shared result renderer for the competitive-analysis API output.
// Used by both:
//   - the /competitive standalone page (form + this card)
//   - the equity chat surface (chat message containing this card)
// Changing the card visuals here updates both surfaces.

import { useMemo } from "react";
import {
  FORCE_KEYS,
  type ForcesObject,
  type Lang,
  type SuccessResponse,
} from "@/lib/competitive/types";
import { TRANSLATIONS } from "@/lib/competitive/i18n";
import { Card, CardHeader } from "./ui";
import { RadarChartPanel } from "./RadarChartPanel";
import { ForceCard } from "./ForceCard";
import { OverallAssessmentCard } from "./OverallAssessmentCard";
import { GroundingBanner } from "./GroundingBanner";
import { PressureLegend } from "./PressureLegend";

type Props = {
  data: SuccessResponse;
  lang: Lang;
};

// Pick the language-specific slice of the result. Backend inlines a `zh`
// block when lang=both was requested; otherwise top-level fields hold
// whichever single language was generated.
const pickDisplaySlice = (
  result: SuccessResponse,
  lang: Lang,
): {
  forces: ForcesObject;
  assessment: string;
  industry: string;
} => {
  const useZh = lang === "zh" && Boolean(result.zh?.forces);
  return {
    forces: useZh && result.zh?.forces ? result.zh.forces : result.forces,
    assessment:
      useZh && result.zh?.overall_assessment
        ? result.zh.overall_assessment
        : result.overall_assessment,
    industry:
      useZh && result.zh?.industry ? result.zh.industry : result.industry,
  };
};

export const CompetitiveResultCard = ({ data, lang }: Props) => {
  const t = TRANSLATIONS[lang];
  const display = useMemo(() => pickDisplaySlice(data, lang), [data, lang]);

  const radarData = useMemo(
    () =>
      FORCE_KEYS.map((key) => ({
        force: t.forceLabels[key],
        score: display.forces[key]?.score ?? 0,
      })),
    [display, t],
  );

  return (
    <Card>
      <CardHeader
        icon="📈"
        title={`${t.resultsTitle}: ${data.company}${
          display.industry ? ` · ${display.industry}` : ""
        }`}
      />

      {!data.research_grounded && (
        <GroundingBanner message={t.groundingWarning} />
      )}

      <RadarChartPanel data={radarData} seriesName={t.forceIntensity} />

      <OverallAssessmentCard
        label={t.overallAssessment}
        text={display.assessment}
      />

      <PressureLegend
        caption={t.legendCaption}
        high={t.legendHigh}
        moderate={t.legendModerate}
        low={t.legendLow}
      />

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {FORCE_KEYS.map((key) => {
          const force = display.forces[key];
          if (!force) return null;
          return (
            <ForceCard
              key={key}
              label={t.forceLabels[key]}
              score={force.score}
              analysis={force.analysis}
            />
          );
        })}
      </div>

    </Card>
  );
};

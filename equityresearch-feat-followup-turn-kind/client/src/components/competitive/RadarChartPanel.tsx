import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export type RadarDatum = {
  force: string;
  score: number;
};

type Props = {
  data: RadarDatum[];
  seriesName: string;
};

export const RadarChartPanel = ({ data, seriesName }: Props) => (
  <div className="my-6 h-[320px] md:h-[420px]">
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="75%">
        <PolarGrid stroke="#e5e7eb" />
        <PolarAngleAxis
          dataKey="force"
          tick={{ fill: "#0a2540", fontSize: 12, fontWeight: 600 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 10]}
          tick={{ fill: "#6b7280", fontSize: 10 }}
        />
        <Radar
          name={seriesName}
          dataKey="score"
          stroke="#00d4aa"
          fill="#00d4aa"
          fillOpacity={0.3}
          strokeWidth={2}
        />
        <Tooltip
          contentStyle={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            fontSize: 13,
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  </div>
);

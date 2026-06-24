import { SectionLabel } from "./ui";

type Props = {
  label: string;
  text: string;
};

export const OverallAssessmentCard = ({ label, text }: Props) => (
  <div
    className="mt-6 rounded-xl p-5"
    style={{ background: "linear-gradient(135deg, #e8f5ff 0%, #f0f9ff 100%)" }}
  >
    <SectionLabel>{label}</SectionLabel>
    <div className="leading-relaxed text-[#1a1a1a]">{text}</div>
  </div>
);

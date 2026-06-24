type Props = {
  message: string;
};

export const GroundingBanner = ({ message }: Props) => (
  <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
    {message}
  </div>
);

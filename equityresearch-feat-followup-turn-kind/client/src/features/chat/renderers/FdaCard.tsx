import type { FdaResponse, FdaData, FdaDrugEvent } from "@shared/fda";
import type { UILanguage } from "@/utils/i18n";

/**
 * Frontend renderer for the FDA drug-pipeline card — structured replacement for
 * server/agent/formatters/fda.ts. Consumes the shared FdaResponse contract
 * ({ success, data }); `data` is one company (detailed pipeline table) or an
 * array of companies (overview table). Labels bilingual, rendered client-side.
 * Generic source_card channel (docs/CARD_RENDER_MIGRATION_PLAN.md).
 */
export const FdaCard = ({
  payload,
  uiLanguage,
}: {
  payload: FdaResponse;
  uiLanguage: UILanguage;
}) => {
  const isZh = uiLanguage === "zh";
  const d = payload as { success?: boolean; data?: FdaData | FdaData[] };

  const t = {
    title: isZh ? "FDA药品管线事件" : "FDA Drug Pipeline Events",
    overview: isZh ? "FDA药品管线概览" : "FDA Drug Pipeline Overview",
    ticker: "Ticker",
    company: isZh ? "公司" : "Company",
    drug: isZh ? "药品" : "Drug",
    indication: isZh ? "适应症" : "Indication",
    date: isZh ? "日期" : "Date",
    event: isZh ? "事件" : "Event",
    status: isZh ? "状态" : "Status",
    fdaAction: isZh ? "FDA审批" : "FDA Action",
    pending: isZh ? "待审批" : "Pending",
    showing: isZh ? "共" : "Showing",
    results: isZh ? "条结果" : "results",
    noData: isZh ? "暂无药品管线数据" : "No drug pipeline data available for",
    noSubmissions: isZh ? "该公司可能没有正在进行的FDA申请。" : "This company may not have active FDA submissions.",
    error: isZh ? "暂无FDA数据" : "No FDA data available",
  };

  if (!d.success && !d.data) return <ErrorCard msg={t.error} />;
  const fdaData = d.data;

  // Overview: an array of companies → compact 4-column table.
  if (Array.isArray(fdaData)) {
    return (
      <Shell title={`💊 ${t.overview}`}>
        <Table head={[t.ticker, t.company, t.drug, t.status]} center={[3]}>
          {fdaData.map((company, idx) => {
            const first = company.drugs?.[0] ?? ({} as FdaDrugEvent);
            return (
              <tr key={idx} className={`border-b border-gray-200 ${idx % 2 ? "bg-gray-50" : "bg-white"}`}>
                <Td className="font-semibold text-blue-500">{company.ticker}</Td>
                <Td className="text-gray-800">{company.company}</Td>
                <Td className="text-gray-800">{first.drug || "N/A"}</Td>
                <Td center><StatusPill status={first.status} pending={t.pending} /></Td>
              </tr>
            );
          })}
        </Table>
      </Shell>
    );
  }

  const company = fdaData;
  if (!company) return <ErrorCard msg={isZh ? "未找到公司数据" : "No company data found"} />;

  // Detail: single company with its pipeline drugs → 7-column table.
  if (!company.drugs || company.drugs.length === 0) {
    return (
      <Shell title={`💊 ${t.title}`}>
        <div className="rounded-lg border-l-4 border-blue-500 bg-sky-50 p-4">
          <div className="font-semibold text-gray-800">ℹ️ {t.noData} {company.company || (isZh ? "该公司" : "this company")}</div>
          <div className="mt-1 text-gray-500">{t.noSubmissions}</div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={`💊 ${t.title}`}>
      <Table head={[t.ticker, t.company, t.drug, t.indication, t.date, t.event, t.status]} center={[4, 5, 6]}>
        {company.drugs.map((drug, idx) => (
          <tr key={drug.id ?? idx} className={idx % 2 ? "bg-gray-50" : "bg-white"}>
            <Td className="font-semibold text-gray-800">{company.ticker}</Td>
            <Td className="text-gray-800">{company.company}</Td>
            <Td className="font-medium text-gray-800">{drug.drug}</Td>
            <Td className="text-[0.9em] text-gray-500">{drug.indication || "N/A"}</Td>
            <Td center className="text-gray-800">{drug.date || company.latestUpdate || "TBD"}</Td>
            <Td center className="text-[0.9em] text-gray-800">{drug.event || t.fdaAction}</Td>
            <Td center><StatusPill status={drug.status} pending={t.pending} /></Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 text-[0.9em] text-gray-500">{t.showing} {company.drugs.length} {t.results}</div>
    </Shell>
  );
};

const Shell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="overflow-hidden rounded-xl bg-white p-4 shadow-sm">
    <div className="mb-3 font-bold text-gray-800">{title}</div>
    {children}
  </div>
);

const ErrorCard = ({ msg }: { msg: string }) => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">💊 {msg}</div>
);

const Table = ({ head, center, children }: { head: string[]; center?: number[]; children: React.ReactNode }) => {
  const centerSet = new Set(center ?? []);
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-blue-50">
            {head.map((h, i) => (
              <th key={h} className={`px-2.5 py-2.5 font-semibold text-slate-800 ${centerSet.has(i) ? "text-center" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
};

const Td = ({ children, center, className = "" }: { children: React.ReactNode; center?: boolean; className?: string }) => (
  <td className={`px-2.5 py-2.5 ${center ? "text-center" : ""} ${className}`}>{children}</td>
);

const StatusPill = ({ status, pending }: { status?: string; pending: string }) => {
  const approved = status === "APPROVED";
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-[0.85em] font-semibold ${approved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
      {status || pending}
    </span>
  );
};

// server/agent/formatters/fda.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import {
  formatErrorCard,
} from "./_shared";

export function formatFDACard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  if (!data.success && !data.data) {
    return formatErrorCard("FDA", isZh ? "暂无FDA数据" : "No FDA data available");
  }

  const fdaData = Array.isArray(data.data) ? data.data : data.data?.data || data.data;

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
  };

  if (fdaData && !Array.isArray(fdaData)) {
    const company = Array.isArray(fdaData) ? fdaData[0] : fdaData;

    if (!company) {
      return formatErrorCard("FDA", isZh ? "未找到公司数据" : "No company data found");
    }

    let content = `<strong>💊 ${t.title}</strong><br><br>`;

    if (company.drugs && company.drugs.length > 0) {
      content += `<div style="background: white; border-radius: 8px; overflow-x: auto;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb;
            -webkit-overflow-scrolling: touch;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #eff6ff;">
                <th style="padding: 10px; text-align: left; font-weight: 600; color: #1e293b; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">${t.ticker}</th>
                <th style="padding: 10px; text-align: left; font-weight: 600; color: #1e293b; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">${t.company}</th>
                <th style="padding: 10px; text-align: left; font-weight: 600; color: #1e293b; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">${t.drug}</th>
                <th style="padding: 10px; text-align: left; font-weight: 600; color: #1e293b; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">${t.indication}</th>
                <th style="padding: 10px; text-align: center; font-weight: 600; color: #1e293b; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">${t.date}</th>
                <th style="padding: 10px; text-align: center; font-weight: 600; color: #1e293b; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">${t.event}</th>
                <th style="padding: 10px; text-align: center; font-weight: 600; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${t.status}</th>
              </tr>
            </thead>
            <tbody>`;

      company.drugs.forEach((drug: any, idx: number) => {
        const bgColor = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
        const statusBg = drug.status === "APPROVED" ? "#3b82f6" : "#fbbf24";

        content += `
          <tr style="background: ${bgColor};">
            <td style="padding: 10px; font-weight: 600; color: #1e293b; border-right: 1px solid #e2e8f0;">${company.ticker}</td>
            <td style="padding: 10px; color: #1e293b; border-right: 1px solid #e2e8f0;">${company.company}</td>
            <td style="padding: 10px; color: #1e293b; font-weight: 500; border-right: 1px solid #e2e8f0;">${drug.drug}</td>
            <td style="padding: 10px; color: #64748b; font-size: 0.9em; border-right: 1px solid #e2e8f0;">${drug.indication || "N/A"}</td>
            <td style="padding: 10px; text-align: center; color: #1e293b; border-right: 1px solid #e2e8f0;">${drug.date || company.latestUpdate || "TBD"}</td>
            <td style="padding: 10px; text-align: center; color: #1e293b; font-size: 0.9em; border-right: 1px solid #e2e8f0;">${drug.event || t.fdaAction}</td>
            <td style="padding: 10px; text-align: center;">
              <span style="display: inline-block; padding: 4px 12px; background: ${statusBg}; color: white; border-radius: 12px; font-size: 0.85em; font-weight: 600;">
                ${drug.status || t.pending}
              </span>
            </td>
          </tr>`;
      });

      content += `</tbody></table></div>`;
      content += `<div style="margin-top: 12px; color: #64748b; font-size: 0.9em;">
        ${t.showing} ${company.drugs.length} ${t.results}
      </div>`;
    } else {
      content += `<div style="padding: 16px; background: #f0f9ff; border-left: 4px solid #3b82f6; border-radius: 8px;">
        <strong>ℹ️ ${t.noData} ${company.company || (isZh ? "该公司" : "this company")}</strong><br>
        <span style="color: #64748b;">${t.noSubmissions}</span>
      </div>`;
    }

    return content;
  }

  if (Array.isArray(fdaData)) {
    let content = `<strong>💊 ${t.overview}</strong><br><br>`;
    content += `<div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f8fafc; border-bottom: 1px solid #e5e7eb;">
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569;">${t.ticker}</th>
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569;">${t.company}</th>
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #475569;">${t.drug}</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #475569;">${t.status}</th>
          </tr>
        </thead>
        <tbody>`;

    fdaData.forEach((company: any, idx: number) => {
      const bgColor = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
      const firstDrug = company.drugs?.[0] || {};
      content += `
        <tr style="background: ${bgColor}; border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 12px; font-weight: 600; color: #3b82f6;">${company.ticker}</td>
          <td style="padding: 12px; color: #1f2937;">${company.company}</td>
          <td style="padding: 12px; color: #1f2937;">${firstDrug.drug || "N/A"}</td>
          <td style="padding: 12px; text-align: center;">
            <span style="padding: 4px 12px; background: ${firstDrug.status === "APPROVED" ? "#dcfce7" : "#fef3c7"};
                   color: ${firstDrug.status === "APPROVED" ? "#166534" : "#92400e"};
                   border-radius: 12px; font-size: 0.85em; font-weight: 600;">
              ${firstDrug.status || t.pending}
            </span>
          </td>
        </tr>`;
    });

    content += `</tbody></table></div>`;
    return content;
  }

  return formatErrorCard("FDA", isZh ? "FDA数据格式异常" : "Unexpected FDA data format");
}

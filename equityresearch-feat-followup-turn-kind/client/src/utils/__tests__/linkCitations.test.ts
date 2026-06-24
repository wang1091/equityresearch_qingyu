import { describe, it, expect } from "vitest";
import { linkCitations, renderMarkdownToHtml } from "../renderMarkdown";

const ids = new Set(["S1", "S2"]);

describe("linkCitations", () => {
  it("converts ASCII [S#] markers to anchored superscripts", () => {
    const out = linkCitations("revenue grew 85% [S2].", ids, "cite-7");
    expect(out).toContain('href="#cite-7-S2"');
    expect(out).toContain(">2</a>");
    expect(out).not.toContain("[S2]");
  });

  it("also converts fullwidth 【S#】 markers (zh model output)", () => {
    const out = linkCitations("营收增长 85%【S2】。", ids, "cite-7");
    expect(out).toContain('href="#cite-7-S2"');
    expect(out).not.toContain("【S2】");
  });

  it("strips echoed data-block headers in both bracket styles", () => {
    expect(linkCitations("数据缺失：【TRENDING | cite=S1】仅提供…", ids, "c")).not.toContain("cite=S1");
    expect(linkCitations("note: [NEWS | cite=S2] says…", ids, "c")).not.toContain("cite=S2");
  });

  it("strips unknown/hallucinated ids", () => {
    const out = linkCitations("claim [S9] and [S1].", ids, "c");
    expect(out).not.toContain("S9");
    expect(out).toContain("#c-S1");
  });

  it("links single-source citations straight to the article (new tab)", () => {
    const urls = new Map([["S1", "https://example.com/a?b=1&c=2"]]);
    const out = linkCitations("see [S1].", ids, "c", urls);
    expect(out).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("#c-S1"); // not the footer anchor
  });

  it("keeps multi-source / unmapped citations as footer anchors", () => {
    const urls = new Map([["S1", "https://example.com/a"]]);
    const out = linkCitations("a [S1] b [S2].", ids, "c", urls);
    expect(out).toContain('href="https://example.com/a"'); // S1 maps → direct
    expect(out).toContain('href="#c-S2"'); // S2 unmapped → footer
  });
});

describe("renderMarkdownToHtml — GFM tables", () => {
  it("renders a pipe table as <table> (not raw pipes)", () => {
    const md = "| Metric | Value |\n| :--- | :--- |\n| Price | $400.49 |\n| Volume | 58,384,713 |";
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("Price");
    expect(html).toContain("$400.49");
    expect(html).not.toContain("| Metric |");
  });

  it("leaves a lone pipe line as a paragraph (no false table)", () => {
    const html = renderMarkdownToHtml("a | b without a separator row");
    expect(html).not.toContain("<table");
  });
});

describe("renderMarkdownToHtml — visual hierarchy", () => {
  it("styles headings by depth and restores list markers", () => {
    const html = renderMarkdownToHtml("## Section\ntext\n- a\n- b");
    expect(html).toMatch(/<h3 style="[^"]*font-weight:700/);
    expect(html).toContain("list-style:disc");
    expect(html).toContain("<li style=");
  });
});

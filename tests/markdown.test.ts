import { describe, it, expect } from "vitest";
import readme from "../README.md?raw";
import { renderMarkdown, renderInline, extractHelp } from "../src/ui/markdown";

describe("renderInline", () => {
  it("handles code, bold, italic and links", () => {
    expect(renderInline("a `x*y` **b** *c* [d](https://e.f)")).toBe(
      'a <code>x*y</code> <strong>b</strong> <em>c</em> <a href="https://e.f" target="_blank" rel="noopener">d</a>',
    );
  });

  it("escapes HTML", () => {
    expect(renderInline("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
    expect(renderInline("`<i>`")).toBe("<code>&lt;i&gt;</code>");
  });

  it("leaves arithmetic-looking asterisks alone", () => {
    expect(renderInline("2*3*4")).toBe("2*3*4");
  });
});

describe("renderMarkdown", () => {
  it("renders headings, paragraphs and lists", () => {
    const html = renderMarkdown("## Title\n\nOne\ntwo.\n\n- a\n- b\n  continued\n\nEnd");
    expect(html).toBe("<h2>Title</h2>\n<p>One two.</p>\n<ul><li>a</li><li>b continued</li></ul>\n<p>End</p>");
  });

  it("renders tables and skips the separator row", () => {
    const html = renderMarkdown("| A | B |\n|---|---|\n| `x` | y |");
    expect(html).toBe(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><code>x</code></td><td>y</td></tr></tbody></table>",
    );
  });

  it("renders fenced code verbatim", () => {
    expect(renderMarkdown("```sh\na <b> *c*\n```")).toBe("<pre><code>a &lt;b&gt; *c*</code></pre>");
  });

  it("drops HTML comments", () => {
    expect(renderMarkdown("<!-- hidden -->\ntext")).toBe("<p>text</p>");
  });
});

describe("README help section", () => {
  const help = extractHelp(readme);

  it("contains the visitor-facing parts only", () => {
    expect(help).toContain("## Modes");
    expect(help).toContain("## Controls");
    expect(help).not.toContain("npm install");
    expect(help).not.toContain("## Code layout");
  });

  it("renders without leftover Markdown syntax", () => {
    const html = renderMarkdown(help);
    expect(html).toContain("<table>");
    expect(html).not.toMatch(/\*\*|^#|\|---/m);
  });
});

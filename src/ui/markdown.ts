// Minimal Markdown → HTML for the help overlay. Covers what README.md uses:
// headings, paragraphs, "-" lists, pipe tables, fenced code, and inline
// `code`, **bold**, *italic* and [links](url). Everything is HTML-escaped.

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderInline(text: string): string {
  // Pull code spans out first so their contents are left alone.
  const codes: string[] = [];
  let s = escapeHtml(text).replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${renderInline(para.join(" "))}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*<!--.*-->\s*$/.test(line) || line.trim() === "") {
      flushPara();
      continue;
    }

    if (line.startsWith("```")) {
      flushPara();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const n = h[1].length;
      out.push(`<h${n}>${renderInline(h[2])}</h${n}>`);
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      flushPara();
      const rows: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(lines[i++]);
      i--;
      const [head, ...rest] = rows;
      const body = rest.length && isTableSeparator(rest[0]) ? rest.slice(1) : rest;
      const th = splitRow(head).map((c) => `<th>${renderInline(c)}</th>`).join("");
      const trs = body
        .map((r) => `<tr>${splitRow(r).map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length) {
        const item = /^\s*[-*]\s+(.*)$/.exec(lines[i]);
        if (item) items.push(item[1]);
        else if (/^\s+\S/.test(lines[i]) && items.length) items[items.length - 1] += " " + lines[i].trim();
        else break;
        i++;
      }
      i--;
      out.push(`<ul>${items.map((t) => `<li>${renderInline(t)}</li>`).join("")}</ul>`);
      continue;
    }

    para.push(line.trim());
  }
  flushPara();
  return out.join("\n");
}

/** The part of a document between `<!-- help:start -->` and `<!-- help:end -->`. */
export function extractHelp(md: string): string {
  const m = /<!--\s*help:start[^>]*-->([\s\S]*?)<!--\s*help:end\s*-->/.exec(md);
  return m ? m[1] : md;
}

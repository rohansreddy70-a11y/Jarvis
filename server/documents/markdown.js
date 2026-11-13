// Parses the Markdown subset JARVIS documents use into blocks:
//   heading{level,text} · paragraph{text} · bullets{items} · numbered{items}
//   table{columns,rows} · pagebreak · rule
// Inline: **bold**, *italic* / _italic_, `code` (rendered plain).
export function parseMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join(' ').trim() });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let m;
    if (!trimmed) { flush(); continue; }
    if (/^(---+|\*\*\*+)$/.test(trimmed)) { flush(); blocks.push({ type: 'rule' }); continue; }
    if (/^\\pagebreak$|^<!--\s*pagebreak\s*-->$/i.test(trimmed)) { flush(); blocks.push({ type: 'pagebreak' }); continue; }
    if ((m = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/))) { flush(); blocks.push({ type: 'heading', level: Math.min(m[1].length, 3), text: m[2] }); continue; }
    if (/^\|.*\|$/.test(trimmed)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        const cells = lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const norm = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
        blocks.push({ type: 'table', columns: norm[0], rows: norm.slice(1) });
      }
      continue;
    }
    const bullet = /^\s*[-*+•]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      flush();
      const kind = bullet.test(line) ? 'bullets' : 'numbered';
      const re = kind === 'bullets' ? bullet : numbered;
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        const indent = lines[i].match(/^\s*/)[0].length;
        items.push({ text: lines[i].match(re)[1], level: indent >= 2 ? 1 : 0 });
        i++;
      }
      i--;
      blocks.push({ type: kind, items });
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

// Splits inline markdown into runs: [{ text, bold, italic }]
export function inlineRuns(text) {
  const runs = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`)/g;
  let last = 0;
  let m;
  const s = String(text || '');
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    if (m[2] || m[3]) runs.push({ text: m[2] || m[3], bold: true });
    else if (m[4] || m[5]) runs.push({ text: m[4] || m[5], italic: true });
    else runs.push({ text: m[6] });
    last = re.lastIndex;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs.filter((r) => r.text);
}

export const plain = (text) => inlineRuns(text).map((r) => r.text).join('');

// PDF generator (no dependencies) using the standard Helvetica fonts.
// Supports headings, paragraphs with **bold**/*italic*, bullet and numbered
// lists, tables (header repeated across pages), rules, page breaks, and
// "Page X of Y" footers. Text uses WinAnsi encoding: Latin text renders
// exactly; characters outside it (e.g. Devanagari, emoji) are replaced —
// use Word (.docx) for those.
import { inlineRuns } from './markdown.js';

// Glyph widths (1/1000 em) for ASCII 32–126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// WinAnsi extras: char → [code, width regular, width bold]
const EXTRA = {
  '•': [0x95, 350, 350], '–': [0x96, 556, 556], '—': [0x97, 1000, 1000], '‘': [0x91, 222, 278], '’': [0x92, 222, 278],
  '“': [0x93, 333, 500], '”': [0x94, 333, 500], '…': [0x85, 1000, 1000], '€': [0x80, 556, 556], '·': [0xB7, 278, 278],
  '©': [0xA9, 737, 737], '®': [0xAE, 737, 737], '°': [0xB0, 400, 400], '±': [0xB1, 584, 584], '×': [0xD7, 584, 584],
  '£': [0xA3, 556, 556], '¥': [0xA5, 556, 556], 'é': [0xE9, 556, 556], 'è': [0xE8, 556, 556], 'ü': [0xFC, 556, 611],
  'ö': [0xF6, 556, 611], 'ä': [0xE4, 556, 556], 'ñ': [0xF1, 556, 611], 'ç': [0xE7, 500, 556], 'á': [0xE1, 556, 556],
  'í': [0xED, 278, 278], 'ó': [0xF3, 556, 611], 'ú': [0xFA, 556, 611], ' ': [0x20, 278, 278],
};
const REPLACE = { '₹': 'Rs.', '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '✕': 'x', '⚠': '!', '≤': '<=', '≥': '>=', '\t': '    ' };

// Normalizes text to what the fonts can draw.
export function toWinAnsi(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code <= 126) out += ch;
    else if (EXTRA[ch]) out += ch;
    else if (REPLACE[ch]) out += REPLACE[ch];
    else if (/\p{Extended_Pictographic}|️|‍/u.test(ch)) continue; // drop emoji
    else out += '?';
  }
  return out;
}

const charWidth = (ch, bold) => {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return (bold ? HELV_B : HELV)[c - 32];
  const e = EXTRA[ch];
  return e ? e[bold ? 2 : 1] : 556;
};
const textWidth = (s, size, bold) => [...s].reduce((w, ch) => w + charWidth(ch, bold), 0) * size / 1000;

const encode = (s) => [...s].map((ch) => {
  const e = EXTRA[ch];
  const c = e ? e[0] : ch.charCodeAt(0);
  if (c === 0x28 || c === 0x29 || c === 0x5C) return `\\${ch}`;
  return c < 128 ? ch : `\\${c.toString(8).padStart(3, '0')}`;
}).join('');

const FONT = { regular: 'F1', bold: 'F2', italic: 'F3', boldItalic: 'F4' };
const fontKey = (b, i) => (b && i ? 'boldItalic' : b ? 'bold' : i ? 'italic' : 'regular');

// Page geometry (A4, points).
const PW = 595.28;
const PH = 841.89;
const M = 56;
const CW = PW - 2 * M;
const ACCENT = [0.12, 0.31, 0.47];

export function buildPdf({ title, subtitle, blocks }) {
  const pages = [];
  let ops = [];
  let y = PH - M;
  const newPage = () => { ops = []; pages.push(ops); y = PH - M; };
  newPage();
  const ensure = (h) => { if (y - h < M + 20) newPage(); };
  const color = ([r, g, b]) => `${r} ${g} ${b} rg`;

  // Draw a list of words (each {text, bold, italic}) wrapped into `width`.
  function wrapRuns(runs, size, width) {
    const words = [];
    for (const r of runs) {
      const parts = toWinAnsi(r.text).split(/(\s+)/);
      for (const p of parts) if (p) words.push({ text: p, bold: !!r.bold, italic: !!r.italic, space: /^\s+$/.test(p) });
    }
    const lines = [];
    let line = [];
    let w = 0;
    for (const word of words) {
      const ww = textWidth(word.space ? ' ' : word.text, size, word.bold);
      if (word.space) { if (line.length) { line.push({ ...word, text: ' ' }); w += ww; } continue; }
      if (w + ww > width && line.length) {
        while (line.length && line[line.length - 1].space) line.pop();
        lines.push(line); line = []; w = 0;
      }
      // Hard-break words longer than the line.
      if (ww > width) {
        let chunk = '';
        for (const ch of word.text) {
          if (textWidth(chunk + ch, size, word.bold) > width) { lines.push([{ ...word, text: chunk }]); chunk = ''; }
          chunk += ch;
        }
        line = [{ ...word, text: chunk }]; w = textWidth(chunk, size, word.bold);
        continue;
      }
      line.push(word); w += ww;
    }
    while (line.length && line[line.length - 1].space) line.pop();
    if (line.length) lines.push(line);
    return lines;
  }

  function drawLine(line, xPos, yPos, size, rgb = [0.12, 0.13, 0.15]) {
    let cx = xPos;
    let out = `BT ${color(rgb)} `;
    for (const w of line) {
      out += `/${FONT[fontKey(w.bold, w.italic)]} ${size} Tf 1 0 0 1 ${cx.toFixed(2)} ${yPos.toFixed(2)} Tm (${encode(w.text)}) Tj `;
      cx += textWidth(w.text, size, w.bold);
    }
    ops.push(`${out}ET`);
  }

  function paragraph(text, { size = 10.5, indent = 0, bold = false, rgb, before = 0, after = 6, lead = 1.4, keepWithNext = 0, marker } = {}) {
    const runs = inlineRuns(text).map((r) => ({ ...r, bold: r.bold || bold }));
    const lines = wrapRuns(runs.length ? runs : [{ text: ' ' }], size, CW - indent);
    const lh = size * lead;
    y -= before;
    ensure(lh * Math.min(lines.length, 2) + keepWithNext);
    lines.forEach((line, i) => {
      ensure(lh);
      y -= lh;
      drawLine(line, M + indent, y + size * 0.25, size, rgb);
      if (i === 0 && marker) drawLine([{ text: marker }], M + indent - 13, y + size * 0.25, size, ACCENT);
    });
    y -= after;
  }

  function table(block) {
    const cols = block.columns.length;
    const size = cols > 5 ? 8.5 : 9.5;
    const pad = 5;
    const lens = block.columns.map((c, i) => Math.min(40, Math.max(String(c).length, ...block.rows.map((r) => String(r[i] ?? '').length), 3)));
    const sum = lens.reduce((a, b) => a + b, 0);
    const widths = lens.map((l) => (l / sum) * CW);
    const lh = size * 1.3;
    const rowLines = (cells, bold) => cells.map((c, i) => wrapRuns(inlineRuns(String(c ?? '')).map((r) => ({ ...r, bold: r.bold || bold })), size, widths[i] - 2 * pad));
    const drawRow = (cells, header, band) => {
      const lines = rowLines(cells, header);
      const h = Math.max(1, ...lines.map((l) => l.length)) * lh + 2 * pad;
      if (y - h < M + 20) { newPage(); if (!header) drawRow(block.columns, true); }
      const top = y;
      const fill = header ? ACCENT : band ? [0.93, 0.95, 0.98] : null;
      if (fill) ops.push(`${color(fill)} ${M} ${(top - h).toFixed(2)} ${CW.toFixed(2)} ${h.toFixed(2)} re f`);
      let cx = M;
      lines.forEach((cellLines, i) => {
        cellLines.forEach((l, li) => drawLine(l, cx + pad, top - pad - (li + 1) * lh + size * 0.3, size, header ? [1, 1, 1] : undefined));
        cx += widths[i];
      });
      // Borders
      ops.push(`0.75 0.75 0.75 RG 0.5 w ${M} ${(top - h).toFixed(2)} ${CW.toFixed(2)} ${h.toFixed(2)} re S`);
      let vx = M;
      for (let i = 0; i < cols - 1; i++) { vx += widths[i]; ops.push(`${vx.toFixed(2)} ${top.toFixed(2)} m ${vx.toFixed(2)} ${(top - h).toFixed(2)} l S`); }
      y -= h;
    };
    y -= 4;
    ensure(lh * 3 + 4 * pad);
    drawRow(block.columns, true);
    block.rows.forEach((r, ri) => drawRow(r, false, ri % 2 === 1));
    y -= 10;
  }

  if (title) {
    paragraph(title, { size: 22, bold: true, rgb: ACCENT, after: subtitle ? 2 : 4, lead: 1.25 });
    if (subtitle) paragraph(subtitle, { size: 12, rgb: [0.4, 0.4, 0.4], after: 4 });
    ops.push(`${color(ACCENT)} ${M} ${(y - 2).toFixed(2)} 60 2 re f`);
    y -= 16;
  }
  for (const b of blocks) {
    if (b.type === 'heading') {
      const size = [0, 16, 13, 11.5][b.level];
      paragraph(b.text, { size, bold: true, rgb: b.level < 3 ? ACCENT : [0.25, 0.25, 0.25], before: b.level === 1 ? 10 : 6, after: 4, lead: 1.3, keepWithNext: 30 });
    } else if (b.type === 'paragraph') paragraph(b.text);
    else if (b.type === 'bullets' || b.type === 'numbered') {
      const counters = [0, 0];
      for (const it of b.items) {
        counters[it.level] += 1;
        if (it.level === 0) counters[1] = 0;
        const indent = 18 + it.level * 18;
        const marker = b.type === 'bullets' ? (it.level ? '–' : '•') : it.level ? `${String.fromCharCode(96 + counters[1])}.` : `${counters[0]}.`;
        paragraph(it.text, { indent, after: 2, marker });
      }
      y -= 4;
    } else if (b.type === 'table') table(b);
    else if (b.type === 'rule') { ensure(12); y -= 6; ops.push(`0.75 0.75 0.75 RG 0.5 w ${M} ${y.toFixed(2)} m ${(PW - M).toFixed(2)} ${y.toFixed(2)} l S`); y -= 8; }
    else if (b.type === 'pagebreak') newPage();
  }

  // Footers
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    const w = textWidth(label, 8.5, false);
    p.push(`BT 0.5 0.5 0.5 rg /F1 8.5 Tf 1 0 0 1 ${((PW - w) / 2).toFixed(2)} ${(M / 2).toFixed(2)} Tm (${label}) Tj ET`);
  });

  return serialize(pages, toWinAnsi(title || 'Document'));
}

function serialize(pages, title) {
  const objs = []; // index = object number - 1
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const fonts = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']
    .map((f) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
  const kids = [];
  for (const p of pages) {
    const stream = p.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R /F4 ${fonts[3]} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${encode(title)}) /Producer (JARVIS) /Creator (JARVIS) >>`);

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

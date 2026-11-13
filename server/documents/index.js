// Document generation entry point. Every format takes the same simple input:
//   docx / pdf / pptx: { title, subtitle?, markdown }
//   xlsx:              { title, sheets: [{ name, columns, rows }] }
import { parseMarkdown } from './markdown.js';
import { buildDocx } from './docx.js';
import { buildPdf } from './pdf.js';
import { buildPptx } from './pptx.js';
import { buildXlsx } from './xlsx.js';

export const FORMATS = {
  docx: { label: 'Word document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { label: 'PDF', mime: 'application/pdf' },
  pptx: { label: 'PowerPoint presentation', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  xlsx: { label: 'Excel spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
};

export function generateDocument(format, { title, subtitle, author, markdown, sheets }) {
  switch (format) {
    case 'docx': return buildDocx({ title, subtitle, author, blocks: parseMarkdown(markdown) });
    case 'pdf': return buildPdf({ title, subtitle, blocks: parseMarkdown(markdown) });
    case 'pptx': return buildPptx({ title, subtitle, author, markdown });
    case 'xlsx': return buildXlsx({ title, author, sheets });
    default: throw new Error(`Unsupported format "${format}".`);
  }
}

// Turns a stored report's plain text into Markdown for export.
export function reportToMarkdown(text) {
  const lines = String(text).split('\n');
  return lines.slice(1).map((l) => {
    const t = l.trim();
    if (!t) return '';
    if (/^•\s/.test(t)) return `- ${t.slice(2)}`;
    if (/^\d+\. .+:$/.test(t) || (/:$/.test(t) && !/^\d+\.\s/.test(t) && t.length < 80)) return `## ${t.replace(/:$/, '')}`;
    return t;
  }).join('\n');
}

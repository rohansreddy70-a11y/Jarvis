// Generated documents: created from Markdown (Word/PDF/PowerPoint) or sheet
// data (Excel), stored under data/documents/, listed, downloaded and deleted.
// Files never leave this machine unless the user downloads them.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { nowIso, ValidationError } from '../lib/time.js';
import { str, oneOf, id as vid, NotFoundError } from './validate.js';
import { FORMATS, generateDocument, reportToMarkdown } from '../documents/index.js';

const MAX_MARKDOWN = 200_000;
const MAX_CELLS = 100_000;

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60) || 'document';

function validateSheets(sheets) {
  if (!Array.isArray(sheets) || !sheets.length) throw new ValidationError('sheets must be a non-empty list of { name, columns, rows }.');
  if (sheets.length > 20) throw new ValidationError('At most 20 sheets.');
  let cells = 0;
  return sheets.map((sh, i) => {
    const columns = Array.isArray(sh.columns) ? sh.columns.map((c) => String(c ?? '')) : [];
    const rows = Array.isArray(sh.rows) ? sh.rows : [];
    if (!rows.every(Array.isArray)) throw new ValidationError(`Sheet ${i + 1}: rows must be a list of lists.`);
    cells += columns.length + rows.reduce((n, r) => n + r.length, 0);
    if (cells > MAX_CELLS) throw new ValidationError(`Too much data (max ${MAX_CELLS} cells).`);
    const clean = rows.map((r) => r.map((v) => (v === null || ['string', 'number', 'boolean'].includes(typeof v) ? v : String(v))));
    return { name: str(sh.name, 'sheet name', { max: 100 }) || `Sheet${i + 1}`, columns, rows: clean };
  });
}

// "a,b,c" / tab-separated text → { columns, rows } (first line is the header).
export function parseDelimited(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return { columns: [], rows: [] };
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const split = (line) => {
    if (delim === '\t') return line.split('\t');
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const [head, ...rest] = lines.map(split);
  return { columns: head, rows: rest };
}

export function createDocumentService(db, activity, config) {
  const dir = config.dbPath === ':memory:' ? fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-docs-')) : path.join(path.dirname(config.dbPath), 'documents');
  const filePath = (d) => {
    const p = path.join(dir, d.filename);
    if (!p.startsWith(dir + path.sep)) throw new ValidationError('Invalid file path.');
    return p;
  };
  const get = (did) => {
    const d = db.prepare('SELECT id, title, format, filename, size, source, created_at FROM documents WHERE id = ?').get(vid(did));
    if (!d) throw new NotFoundError(`Document ${did} not found.`);
    return { ...d, label: FORMATS[d.format].label };
  };

  return {
    FORMATS,
    dir,
    get,
    list() {
      return db.prepare('SELECT id, title, format, filename, size, source, created_at FROM documents ORDER BY id DESC LIMIT 200').all()
        .map((d) => ({ ...d, label: FORMATS[d.format].label }));
    },
    create(input, actor = 'user') {
      const format = oneOf(input.format, 'format', Object.keys(FORMATS), { required: true });
      const title = str(input.title, 'title', { required: true, max: 200 });
      const subtitle = str(input.subtitle, 'subtitle', { max: 300 }) || '';
      const spec = { title, subtitle, author: config.userName || 'JARVIS' };
      if (format === 'xlsx') {
        spec.sheets = input.sheets !== undefined ? validateSheets(input.sheets)
          : validateSheets([{ name: title, ...parseDelimited(str(input.csv, 'csv', { required: true, max: MAX_MARKDOWN })) }]);
      } else {
        spec.markdown = str(input.markdown, 'markdown', { required: true, max: MAX_MARKDOWN });
      }
      const buffer = generateDocument(format, spec);
      fs.mkdirSync(dir, { recursive: true });
      const ts = nowIso();
      const r = db.prepare('INSERT INTO documents (title, format, filename, size, source, spec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(title, format, 'pending', buffer.length, actor, JSON.stringify(spec), ts);
      const docId = Number(r.lastInsertRowid);
      const filename = `${docId}-${slug(title)}.${format}`;
      fs.writeFileSync(path.join(dir, filename), buffer, { mode: 0o600 });
      db.prepare('UPDATE documents SET filename = ? WHERE id = ?').run(filename, docId);
      const doc = get(docId);
      activity.log('document.created', `${doc.label} created: ${title}`, { id: docId, format, size: buffer.length, actor });
      return doc;
    },
    createFromReport(report, format, actor = 'user') {
      if (!['docx', 'pdf'].includes(format)) throw new ValidationError('Reports can be exported as docx or pdf.');
      return this.create({ format, title: report.title, subtitle: `Generated by JARVIS · ${report.created_at.slice(0, 10)}`, markdown: reportToMarkdown(report.content) }, actor);
    },
    read(did) {
      const d = get(did);
      const p = filePath(d);
      if (!fs.existsSync(p)) throw new NotFoundError('The file is missing from disk.');
      return { doc: d, buffer: fs.readFileSync(p), mime: FORMATS[d.format].mime };
    },
    remove(did, actor = 'user') {
      const d = get(did);
      const p = filePath(d);
      db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
      fs.rmSync(p, { force: true });
      activity.log('document.deleted', `${d.label} deleted: ${d.title}`, { id: d.id, actor });
      return d;
    },
  };
}

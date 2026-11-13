import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createApp } from '../server/app.js';
import { createServer } from '../server/http/server.js';
import { testConfig } from './helpers.js';
import { generateDocument, reportToMarkdown } from '../server/documents/index.js';
import { slidesFromMarkdown } from '../server/documents/pptx.js';
import { parseMarkdown } from '../server/documents/markdown.js';
import { toWinAnsi } from '../server/documents/pdf.js';
import { parseDelimited } from '../server/services/documents.js';

// Reads a ZIP via its central directory and inflates every entry (test helper).
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'has end-of-central-directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(local + 26);
    const data = zlib.inflateRawSync(buf.subarray(local + 30 + lnlen, local + 30 + lnlen + csize));
    assert.equal(data.length, usize, `${name} size`);
    assert.equal(zlib.crc32(data) >>> 0, buf.readUInt32LE(p + 16), `${name} crc`);
    files[name] = data.toString('utf8');
    p += 46 + nlen;
  }
  return files;
}

const MD = `## Summary
Spend is **12% under budget** & on track <ok>.

- First point
  - Nested point
1. Step one
2. Step two

| Item | Owner |
|---|---|
| Budget | Rohan |

## Next
Ship it.`;

test('markdown parser handles headings, lists, tables and inline styles', () => {
  const blocks = parseMarkdown(MD);
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'bullets', 'numbered', 'table', 'heading', 'paragraph']);
  assert.equal(blocks[2].items[1].level, 1);
  assert.deepEqual(blocks[4].columns, ['Item', 'Owner']);
});

test('docx: valid package with styled content, escaped text and restartable numbering', () => {
  const f = unzip(generateDocument('docx', { title: 'Report', markdown: MD }));
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/footer1.xml']) assert.ok(f[part], part);
  const doc = f['word/document.xml'];
  assert.match(doc, /<w:pStyle w:val="Title"\/>.*Report/);
  assert.match(doc, /<w:b\/><\/w:rPr><w:t xml:space="preserve">12% under budget/);
  assert.match(doc, /&amp; on track &lt;ok&gt;/);
  assert.match(doc, /<w:tbl>/);
  assert.match(f['word/numbering.xml'], /<w:startOverride w:val="1"\/>/);
});

test('xlsx: typed cells, formulas, frozen header and safe sheet names', () => {
  const f = unzip(generateDocument('xlsx', { title: 'Budget', sheets: [
    { name: 'Q4/Budget', columns: ['Item', 'Amount', 'Share'], rows: [['Travel', '1,200', '12%'], ['Total', '=SUM(B2:B2)', '']] },
    { name: 'q4 budget', columns: ['x'], rows: [] },
  ] }));
  assert.match(f['xl/workbook.xml'], /name="Q4 Budget"/);
  assert.match(f['xl/workbook.xml'], /name="q4 budget \(2\)"/);
  const s1 = f['xl/worksheets/sheet1.xml'];
  assert.match(s1, /<c r="B2"><v>1200<\/v><\/c>/);
  assert.match(s1, /<c r="C2" s="2"><v>0.12<\/v><\/c>/);
  assert.match(s1, /<f>SUM\(B2:B2\)<\/f>/);
  assert.match(s1, /state="frozen"/);
});

test('pptx: one slide per heading, overflow continues on "(cont.)" slides', () => {
  const many = `## Big list\n${Array.from({ length: 12 }, (_, i) => `- item ${i + 1}`).join('\n')}`;
  const slides = slidesFromMarkdown(`${MD}\n\n${many}`);
  assert.deepEqual(slides.map((s) => s.title), ['Summary', 'Summary (cont.)', 'Next', 'Big list', 'Big list (cont.)']);
  assert.equal(slides[0].items.length, 5, 'all text stays together');
  assert.ok(!slides[0].table && slides[1].table && !slides[1].items.length, 'table gets its own slide');
  const small = slidesFromMarkdown('## T\nIntro line\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.equal(small.length, 1, 'short text shares the slide with its table');
  const f = unzip(generateDocument('pptx', { title: 'Deck', markdown: many }));
  const slideFiles = Object.keys(f).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slideFiles.length, 3, 'title + 2 content slides');
  assert.match(f['ppt/presentation.xml'], /<p:sldId id="258" r:id="rId8"\/>/);
  assert.ok(f['ppt/theme/theme1.xml'] && f['ppt/slideMasters/slideMaster1.xml'] && f['ppt/slideLayouts/slideLayout1.xml']);
  assert.ok(!/\.\d+"/.test(f['ppt/slides/slide2.xml'].match(/<a:off[^>]+>/g).join('')), 'integer coordinates');
});

test('pdf: well-formed xref, page footers, WinAnsi-safe text', () => {
  const buf = generateDocument('pdf', { title: 'Report (Q4)', markdown: `${MD}\n\nRupees ₹500 and emoji 🌙 here.` });
  const s = buf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  const xref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(s.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`));
  assert.match(s, /\(Page 1 of 1\) Tj/);
  assert.match(s, /\/Title \(Report \\\(Q4\\\)\)/);
  assert.equal(toWinAnsi('₹5 🌙 “ok”'), 'Rs.5  “ok”');
});

test('documents service: create, list, read, delete; Excel from pasted CSV', async () => {
  const app = createApp(testConfig(), { provider: null });
  const { documents } = app.services;
  const d = documents.create({ format: 'pdf', title: 'Weekly plan', markdown: '# Plan\n- One' });
  assert.equal(d.format, 'pdf');
  assert.match(d.filename, /^\d+-weekly-plan\.pdf$/);
  assert.ok(documents.read(d.id).buffer.toString('latin1').startsWith('%PDF'));
  const x = documents.create({ format: 'xlsx', title: 'Expenses', csv: 'Item,Amount\n"Taxi, airport",450\nLunch,300' });
  const sheet = unzip(documents.read(x.id).buffer)['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /Taxi, airport/);
  assert.match(sheet, /<v>450<\/v>/);
  assert.equal(documents.list().length, 2);
  documents.remove(d.id);
  assert.throws(() => documents.read(d.id), /not found/);
  assert.throws(() => documents.create({ format: 'exe', title: 'x', markdown: 'x' }), /format must be one of/);
  assert.throws(() => documents.create({ format: 'docx', title: 'x' }), /markdown is required/);
  assert.deepEqual(parseDelimited('a\tb\n1\t2'), { columns: ['a', 'b'], rows: [['1', '2']] });
  app.close();
});

test('assistant creates documents directly but needs approval to delete them', async () => {
  const app = createApp(testConfig(), { provider: null });
  const made = await app.toolbox.run('create_document', { format: 'pptx', title: 'Pitch', markdown: '## Why\n- Fast' });
  assert.equal(made.ok, true);
  const id = made.result.document_id;
  const del = await app.toolbox.run('request_delete_document', { id });
  assert.equal(del.result.status, 'awaiting_user_approval');
  assert.ok(app.services.documents.get(id), 'still exists before approval');
  const done = await app.services.approvals.confirm(del.result.approval_id);
  assert.equal(done.status, 'executed');
  assert.throws(() => app.services.documents.get(id), /not found/);
  app.close();
});

test('report export and authenticated download over HTTP', async () => {
  const app = createApp(testConfig({ JARVIS_ACCESS_TOKEN: 'a-long-test-token-1234567890' }), { provider: null });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const auth = { Authorization: 'Bearer a-long-test-token-1234567890' };
  try {
    const report = await app.services.reports.generate('end_of_day');
    assert.match(reportToMarkdown(report.content), /^## 1\. Work completed$/m);
    const res = await fetch(`${base}/reports/${report.id}/export`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"format":"docx"}' });
    const doc = await res.json();
    assert.equal(doc.format, 'docx');
    assert.equal((await fetch(`${base}/documents/${doc.id}/download`)).status, 401, 'download needs the token');
    const dl = await fetch(`${base}/documents/${doc.id}/download`, { headers: auth });
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get('content-type'), /wordprocessingml/);
    assert.match(dl.headers.get('content-disposition'), /attachment; filename="end-of-day/);
    const files = unzip(Buffer.from(await dl.arrayBuffer()));
    assert.match(files['word/document.xml'], /Work completed/);
  } finally {
    server.close();
    app.close();
  }
});

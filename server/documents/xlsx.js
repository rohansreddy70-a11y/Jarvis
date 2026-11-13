// Excel (.xlsx) generator. Sheets: [{ name, columns: [..], rows: [[..]] }].
// Numbers stay numeric, "=..." cells become formulas, header row is bold,
// frozen and filterable, and column widths fit the content.
import { zip } from './zip.js';
import { x, XML_HEAD, coreProps, appProps } from './xml.js';

const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const NUMERIC = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;

function cellXml(value, ref, header) {
  if (value === null || value === undefined || value === '') return '';
  if (header) return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${x(value)}</t></is></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  const s = String(value);
  if (s.startsWith('=') && s.length > 1) return `<c r="${ref}"><f>${x(s.slice(1))}</f></c>`;
  const trimmed = s.trim();
  if (NUMERIC.test(trimmed)) return `<c r="${ref}"><v>${Number(trimmed.replace(/,/g, ''))}</v></c>`;
  const pct = trimmed.match(/^(-?\d+(\.\d+)?)%$/);
  if (pct) return `<c r="${ref}" s="2"><v>${Number(pct[1]) / 100}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(s)}</t></is></c>`;
}

export function sanitizeSheetNames(sheets) {
  const used = new Set();
  return sheets.map((sh, i) => {
    let base = String(sh.name || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} (${n})`.slice(0, 31);
    used.add(name.toLowerCase());
    return { ...sh, name };
  });
}

function sheetXml({ columns = [], rows = [] }) {
  const all = [columns, ...rows];
  const width = Math.max(1, ...all.map((r) => r.length));
  const widths = Array.from({ length: width }, (_, c) => Math.min(60, Math.max(8, ...all.map((r) => String(r[c] ?? '').length + 2))));
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const hasHeader = columns.length > 0;
  const rowXml = all.map((r, ri) => {
    if (ri === 0 && !hasHeader) return '';
    const cells = r.map((v, ci) => cellXml(v, `${colName(ci)}${ri + (hasHeader ? 1 : 0)}`, hasHeader && ri === 0)).join('');
    return `<row r="${ri + (hasHeader ? 1 : 0)}">${cells}</row>`;
  }).join('');
  const lastRow = rows.length + (hasHeader ? 1 : 0);
  const pane = hasHeader ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filter = hasHeader && rows.length ? `<autoFilter ref="A1:${colName(width - 1)}${lastRow}"/>` : '';
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${colName(width - 1)}${Math.max(lastRow, 1)}"/>${pane}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowXml}</sheetData>${filter}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

export function buildXlsx({ title, author, sheets }) {
  const list = sanitizeSheetNames(sheets?.length ? sheets : [{ name: 'Sheet1', columns: [], rows: [] }]);
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = [
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${list.map((s, i) => `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${list.some((s) => s.columns?.length && s.rows?.length) ? `<definedNames>${list.map((s, i) => (s.columns?.length && s.rows?.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(s.name.replace(/'/g, "''"))}'!$A$1:$${colName(Math.max(s.columns.length, ...s.rows.map((r) => r.length)) - 1)}$${s.rows.length + 1}</definedName>` : '')).join('')}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    { name: 'docProps/core.xml', data: coreProps({ title, author }) },
    { name: 'docProps/app.xml', data: appProps('JARVIS') },
  ];
  return zip(files);
}

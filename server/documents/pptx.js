// PowerPoint (.pptx) generator. Markdown → slides:
//   each "#"/"##" heading starts a slide; bullets, numbered items, paragraphs
//   and one table per slide are supported. Long content continues on
//   "(cont.)" slides instead of overflowing.
import { zip } from './zip.js';
import { x, XML_HEAD, coreProps, appProps } from './xml.js';
import { parseMarkdown, inlineRuns } from './markdown.js';

const EMU = 914400; // per inch
const W = 12192000; // 13.333in (16:9)
const H = 6858000; // 7.5in
const NAVY = '0F2A4A';
const ACCENT = '2E86DE';
const TEXT = '1F2937';
const MUTED = '6B7280';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const MAX_ITEMS = 7;
const MAX_TABLE_ROWS = 9;

// ───────── markdown → slide specs ─────────
export function slidesFromMarkdown(md) {
  const blocks = parseMarkdown(md);
  const slides = [];
  let cur = null;
  const start = (title) => { cur = { title, items: [], table: null }; slides.push(cur); };
  for (const b of blocks) {
    if (b.type === 'heading' && b.level <= 2) { start(b.text); continue; }
    if (!cur) start('');
    if (b.type === 'heading') cur.items.push({ text: `**${b.text}**`, level: 0, kind: 'plain' });
    else if (b.type === 'paragraph') cur.items.push({ text: b.text, level: 0, kind: 'plain' });
    else if (b.type === 'bullets') cur.items.push(...b.items.map((i) => ({ ...i, kind: 'bullet' })));
    else if (b.type === 'numbered') cur.items.push(...b.items.map((i) => ({ ...i, kind: 'number' })));
    else if (b.type === 'table') {
      if (cur.table) start(cur.title);
      cur.table = b;
    }
  }
  // Split overflowing slides.
  const out = [];
  for (const s of slides) {
    if (!s.items.length && !s.table && !s.title) continue;
    // A table shares its slide with at most 3 lines of text; with more text,
    // the text gets its own slide(s) and the table follows.
    const shareSlide = s.table && s.items.length <= 3;
    const itemChunks = [];
    for (let i = 0; i < s.items.length; i += MAX_ITEMS) itemChunks.push(s.items.slice(i, i + MAX_ITEMS));
    const tableChunks = [];
    if (s.table) for (let i = 0; i < Math.max(s.table.rows.length, 1); i += MAX_TABLE_ROWS) tableChunks.push({ columns: s.table.columns, rows: s.table.rows.slice(i, i + MAX_TABLE_ROWS) });
    const parts = shareSlide
      ? tableChunks.map((t, k) => ({ items: k === 0 ? s.items : [], table: t }))
      : [...itemChunks.map((items) => ({ items, table: null })), ...tableChunks.map((t) => ({ items: [], table: t }))];
    if (!parts.length) parts.push({ items: [], table: null });
    parts.forEach((part, k) => out.push({ title: k ? `${s.title} (cont.)` : s.title, ...part }));
  }
  return out;
}

// ───────── XML helpers ─────────
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
const spTreeStart = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function runsXml(text, { size, color = TEXT, bold = false }) {
  return inlineRuns(text).map((r) => `<a:r><a:rPr lang="en-IN" sz="${size}"${(bold || r.bold) ? ' b="1"' : ''}${r.italic ? ' i="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${x(r.text)}</a:t></a:r>`).join('')
    || `<a:endParaRPr lang="en-IN" sz="${size}" dirty="0"/>`;
}

function textBox(id, name, box, paragraphs, { anchor = 't', fill } = {}) {
  const { xEmu, y, w, h } = round(box);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${x(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${xEmu}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : '<a:noFill/>'}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function rect(id, name, box, color) {
  const { xEmu, y, w, h } = round(box);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${x(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${xEmu}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-IN"/></a:p></p:txBody></p:sp>`;
}

function itemsXml(items) {
  const longest = Math.max(0, ...items.map((i) => i.text.length));
  const size = items.length <= 4 && longest < 90 ? 2800 : items.length <= 6 && longest < 140 ? 2400 : 2000;
  return items.map((it) => {
    const marL = 342900 + it.level * 457200;
    const bu = it.kind === 'bullet' ? `<a:buClr><a:srgbClr val="${ACCENT}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>`
      : it.kind === 'number' ? `<a:buClr><a:srgbClr val="${ACCENT}"/></a:buClr><a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>` : '<a:buNone/>';
    const pPr = it.kind === 'plain' ? '<a:pPr marL="0" indent="0"><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buNone/></a:pPr>'
      : `<a:pPr marL="${marL}" indent="-342900"><a:spcBef><a:spcPts val="600"/></a:spcBef>${bu}</a:pPr>`;
    return `<a:p>${pPr}${runsXml(it.text, { size: it.level ? size - 400 : size })}</a:p>`;
  }).join('');
}

function tableXml(id, table, box) {
  const { xEmu, y, w } = round(box);
  const cols = table.columns.length;
  const lens = table.columns.map((c, i) => Math.max(String(c).length, ...table.rows.map((r) => String(r[i] ?? '').length), 4));
  const sum = lens.reduce((a, b) => a + b, 0);
  const widths = lens.map((l) => Math.round((l / sum) * w));
  widths[widths.length - 1] += w - widths.reduce((a, b) => a + b, 0);
  const rowH = 480000;
  const size = cols > 5 || table.rows.length > 7 ? 1400 : 1600;
  const cell = (text, header, band) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${runsXml(String(text ?? ''), { size, color: header ? 'FFFFFF' : TEXT, bold: header })}</a:p></a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr"><a:solidFill><a:srgbClr val="${header ? NAVY : band ? 'EEF3F9' : 'FFFFFF'}"/></a:solidFill></a:tcPr></a:tc>`;
  const rows = [
    `<a:tr h="${rowH}">${table.columns.map((c) => cell(c, true)).join('')}</a:tr>`,
    ...table.rows.map((r, ri) => `<a:tr h="${rowH}">${Array.from({ length: cols }, (_, i) => cell(r[i], false, ri % 2 === 1)).join('')}</a:tr>`),
  ].join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${xEmu}" y="${y}"/><a:ext cx="${w}" cy="${rowH * (table.rows.length + 1)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${widths.map((cw) => `<a:gridCol w="${cw}"/>`).join('')}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

const slideXml = (inner, bg = 'FFFFFF') => `${XML_HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${spTreeStart}${inner}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

function titleSlide(title, subtitle) {
  const m = 0.8 * EMU;
  return slideXml(
    rect(2, 'Accent', { xEmu: m, y: 2.55 * EMU, w: 1.2 * EMU, h: 0.08 * EMU }, ACCENT)
    + textBox(3, 'Title', { xEmu: m, y: 2.75 * EMU, w: W - 2 * m, h: 1.5 * EMU }, `<a:p>${runsXml(title || 'Presentation', { size: 4400, color: 'FFFFFF', bold: true })}</a:p>`, { anchor: 't' })
    + (subtitle ? textBox(4, 'Subtitle', { xEmu: m, y: 4.3 * EMU, w: W - 2 * m, h: 0.9 * EMU }, `<a:p>${runsXml(subtitle, { size: 2000, color: 'BFD3EA' })}</a:p>`) : ''),
    NAVY,
  );
}

function contentSlide(s, num) {
  const m = 0.6 * EMU;
  const top = 1.35 * EMU;
  let inner = rect(2, 'Accent bar', { xEmu: 0, y: 0, w: 0.12 * EMU, h: H }, ACCENT)
    + textBox(3, 'Title', { xEmu: m, y: 0.35 * EMU, w: W - 2 * m, h: 0.9 * EMU }, `<a:p>${runsXml(s.title || ' ', { size: 3000, color: NAVY, bold: true })}</a:p>`, { anchor: 'b' })
    + rect(4, 'Divider', { xEmu: m + 91440, y: 1.25 * EMU, w: 0.8 * EMU, h: 0.04 * EMU }, ACCENT);
  let y = top;
  if (s.items.length) {
    const h = s.table ? Math.min(1.6, 0.3 + 0.5 * s.items.length) * EMU : H - top - 0.7 * EMU;
    inner += textBox(5, 'Content', { xEmu: m, y, w: W - 2 * m, h }, itemsXml(s.items));
    y += h + 0.1 * EMU;
  }
  if (s.table) inner += tableXml(6, s.table, { xEmu: m + 91440, y, w: W - 2 * m - 182880 });
  inner += textBox(7, 'Slide number', { xEmu: W - 1.4 * EMU, y: H - 0.55 * EMU, w: 1 * EMU, h: 0.4 * EMU }, `<a:p><a:pPr algn="r"/>${runsXml(String(num), { size: 1100, color: MUTED })}</a:p>`);
  return slideXml(inner);
}

const THEME = `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="JARVIS"><a:themeElements><a:clrScheme name="JARVIS"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${NAVY}"/></a:dk2><a:lt2><a:srgbClr val="EEF3F9"/></a:lt2><a:accent1><a:srgbClr val="${ACCENT}"/></a:accent1><a:accent2><a:srgbClr val="1ABC9C"/></a:accent2><a:accent3><a:srgbClr val="F39C12"/></a:accent3><a:accent4><a:srgbClr val="8E44AD"/></a:accent4><a:accent5><a:srgbClr val="E74C3C"/></a:accent5><a:accent6><a:srgbClr val="7F8C8D"/></a:accent6><a:hlink><a:srgbClr val="2E86DE"/></a:hlink><a:folHlink><a:srgbClr val="8E44AD"/></a:folHlink></a:clrScheme><a:fontScheme name="JARVIS"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="JARVIS"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const MASTER = `${XML_HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${spTreeStart}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `${XML_HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${spTreeStart}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

export function buildPptx({ title, subtitle, author, markdown, slides: given }) {
  const slides = given || slidesFromMarkdown(markdown);
  const all = [titleSlide(title, subtitle), ...slides.map((s, i) => contentSlide(s, i + 2))];
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = [
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>${all.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'ppt/presentation.xml', data: `${XML_HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${all.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 6}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-IN"/></a:defPPr></p:defaultTextStyle></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="theme/theme1.xml"/><Relationship Id="rId3" Type="${REL}/presProps" Target="presProps.xml"/><Relationship Id="rId4" Type="${REL}/viewProps" Target="viewProps.xml"/><Relationship Id="rId5" Type="${REL}/tableStyles" Target="tableStyles.xml"/>${all.map((_, i) => `<Relationship Id="rId${i + 6}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>` },
    { name: 'ppt/presProps.xml', data: `${XML_HEAD}<p:presentationPr ${NS}/>` },
    { name: 'ppt/viewProps.xml', data: `${XML_HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>` },
    { name: 'ppt/tableStyles.xml', data: `${XML_HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>` },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
    { name: 'ppt/theme/theme1.xml', data: THEME },
    ...all.flatMap((xml, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: xml },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>` },
    ]),
    { name: 'docProps/core.xml', data: coreProps({ title, author }) },
    { name: 'docProps/app.xml', data: appProps('JARVIS') },
  ];
  return zip(files);
}

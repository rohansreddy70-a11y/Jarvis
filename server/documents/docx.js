// Word (.docx) generator from parsed Markdown blocks.
import { zip } from './zip.js';
import { x, XML_HEAD, coreProps, appProps } from './xml.js';
import { inlineRuns } from './markdown.js';

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const ACCENT = '1F4E79';

function runs(text, { bold = false, size } = {}) {
  return inlineRuns(text).map((r) => {
    const props = [
      (bold || r.bold) ? '<w:b/>' : '',
      r.italic ? '<w:i/>' : '',
      size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '',
    ].join('');
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${x(r.text)}</w:t></w:r>`;
  }).join('');
}

const para = (content, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;

function table(block) {
  const cols = block.columns.length;
  const total = 9000; // twips of usable width (A4 with 1" margins ≈ 9026)
  // Width proportional to longest content per column, with a floor.
  const lens = block.columns.map((c, i) => Math.max(String(c).length, ...block.rows.map((r) => String(r[i] ?? '').length), 4));
  const sum = lens.reduce((a, b) => a + b, 0);
  const widths = lens.map((l) => Math.max(Math.round((l / sum) * total), 900));
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const cell = (text, i, header) => `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${header ? `<w:shd w:val="clear" w:color="auto" w:fill="${ACCENT}"/>` : ''}</w:tcPr>${para(header ? `<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${x(text)}</w:t></w:r>` : runs(text), '<w:spacing w:before="40" w:after="40"/>')}</w:tc>`;
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.columns.map((c, i) => cell(c, i, true)).join('')}</w:tr>`;
  const body = block.rows.map((r) => `<w:tr>${Array.from({ length: cols }, (_, i) => cell(r[i] ?? '', i, false)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="JarvisTable"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${header}${body}</w:tbl>${para('')}`;
}

export function buildDocx({ title, subtitle, author, blocks }) {
  const numberedLists = []; // each numbered list gets its own w:num so numbering restarts
  let body = '';
  if (title) body += para(runs(title), '<w:pStyle w:val="Title"/>');
  if (subtitle) body += para(runs(subtitle), '<w:pStyle w:val="Subtitle"/>');
  for (const b of blocks) {
    if (b.type === 'heading') body += para(runs(b.text), `<w:pStyle w:val="Heading${b.level}"/>`);
    else if (b.type === 'paragraph') body += para(runs(b.text));
    else if (b.type === 'bullets') {
      for (const it of b.items) body += para(runs(it.text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${it.level}"/><w:numId w:val="1"/></w:numPr>`);
    } else if (b.type === 'numbered') {
      const numId = 2 + numberedLists.length;
      numberedLists.push(numId);
      for (const it of b.items) body += para(runs(it.text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${it.level}"/><w:numId w:val="${numId}"/></w:numPr>`);
    } else if (b.type === 'table') body += table(b);
    else if (b.type === 'pagebreak') body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    else if (b.type === 'rule') body += para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>');
  }
  const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  const document = `${XML_HEAD}<w:document ${W_NS}><w:body>${body}${sect}</w:body></w:document>`;

  const lvl = (ilvl, fmt, text, indent) => `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>${fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : ''}</w:lvl>`;
  const numbering = `${XML_HEAD}<w:numbering ${W_NS}>`
    + `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, 'bullet', '', 720)}${lvl(1, 'bullet', '', 1440)}</w:abstractNum>`
    + `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, 'decimal', '%1.', 720)}${lvl(1, 'lowerLetter', '%2.', 1440)}</w:abstractNum>`
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    + numberedLists.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')
    + '</w:numbering>';

  const heading = (n, size, before, color = ACCENT) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  const styles = `${XML_HEAD}<w:styles ${W_NS}>`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="${ACCENT}"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>`
    + '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>'
    + heading(1, 32, 360) + heading(2, 26, 240) + heading(3, 23, 200, '404040')
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="808080"/><w:sz w:val="18"/></w:rPr></w:style>'
    + '<w:style w:type="table" w:styleId="JarvisTable"><w:name w:val="Jarvis Table"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '</w:styles>';

  const footer = `${XML_HEAD}<w:ftr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="${REL}/footer" Target="footer1.xml"/></Relationships>` },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'word/footer1.xml', data: footer },
    { name: 'docProps/core.xml', data: coreProps({ title, author }) },
    { name: 'docProps/app.xml', data: appProps('JARVIS') },
  ]);
}

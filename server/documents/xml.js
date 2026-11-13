// XML text escaping that also strips characters XML 1.0 forbids.
// eslint-disable-next-line no-control-regex
const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export const x = (s) => String(s ?? '').replace(INVALID, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function coreProps({ title, author = 'JARVIS', created = new Date() }) {
  const ts = created.toISOString().replace(/\.\d+Z$/, 'Z');
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>${x(author)}</dc:creator><cp:lastModifiedBy>${x(author)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${ts}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${ts}</dcterms:modified></cp:coreProperties>`;
}

export function appProps(application = 'JARVIS') {
  return `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>${x(application)}</Application></Properties>`;
}

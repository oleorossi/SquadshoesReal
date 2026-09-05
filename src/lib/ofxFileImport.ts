import { parseOfxStatements, type OfxStatement } from '@/lib/ofxStatement';

/** Limite em bytes, verificado antes de File.arrayBuffer() e da decodificação. */
export const MAX_OFX_FILE_BYTES = 5_000_000;
const MAX_HEADER_BYTES = 16_384;
type OfxEncoding = 'utf-8' | 'windows-1252' | 'iso-8859-1' | 'ascii';

function checkSize(size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Arquivo OFX vazio ou com tamanho inválido.');
  if (size > MAX_OFX_FILE_BYTES) throw new Error('Arquivo OFX excede o limite de 5 MB (5.000.000 bytes).');
}

function invalidHeader(): never {
  throw new Error('Cabeçalho OFX inválido ou ambíguo. Exporte novamente o arquivo pelo banco.');
}

function encodingFor(label: string): OfxEncoding {
  switch (label.toUpperCase()) {
    case 'UTF-8': case 'UTF8': case '65001': return 'utf-8';
    case 'USASCII': case 'US-ASCII': case 'ASCII': case '20127': return 'ascii';
    case '1252': case 'CP1252': case 'WINDOWS-1252': return 'windows-1252';
    case 'ISO-8859-1': case 'ISO8859-1': case 'LATIN1': case '28591': return 'iso-8859-1';
    default: throw new Error(`Codificação OFX não suportada: ${label}. Exporte em UTF-8 ou Windows-1252.`);
  }
}

/** Não deixa atributos repetidos/malformados serem descartados pelo parser do corpo. */
function attributes(raw: string, allowed: string[]): Map<string, string> {
  const result = new Map<string, string>();
  let remaining = raw;
  while (remaining.trim()) {
    const match = /^\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*(["'])([^"'<>]*)\2/.exec(remaining);
    if (!match || !allowed.includes(match[1]) || result.has(match[1])) invalidHeader();
    result.set(match[1], match[3]);
    remaining = remaining.slice(match[0].length);
  }
  return result;
}

function xmlEncoding(header: string): OfxEncoding {
  let remaining = header.trim();
  let encoding: OfxEncoding = 'utf-8';
  if (remaining.startsWith('<?xml')) {
    const match = /^<\?xml(\s[\s\S]*?)\?>/.exec(remaining);
    if (!match) invalidHeader();
    const attrs = attributes(match[1], ['version', 'encoding', 'standalone']);
    if (attrs.get('version') !== '1.0'
      || (attrs.has('standalone') && !['yes', 'no'].includes(attrs.get('standalone')!))) invalidHeader();
    if (attrs.has('encoding')) encoding = encodingFor(attrs.get('encoding')!);
    remaining = remaining.slice(match[0].length).trim();
  }
  if (remaining.startsWith('<?OFX')) {
    const match = /^<\?OFX(\s[\s\S]*?)\?>/.exec(remaining);
    if (!match) invalidHeader();
    const attrs = attributes(match[1], ['OFXHEADER', 'VERSION', 'SECURITY', 'OLDFILEUID', 'NEWFILEUID']);
    if (attrs.get('OFXHEADER') !== '200'
      || (attrs.has('VERSION') && !/^2\d\d$/.test(attrs.get('VERSION')!))) invalidHeader();
    if (attrs.has('SECURITY') && attrs.get('SECURITY') !== 'NONE') {
      throw new Error('OFX protegido exige importador específico. Nenhum conteúdo foi importado.');
    }
    remaining = remaining.slice(match[0].length).trim();
  }
  if (remaining) invalidHeader();
  return encoding;
}

function sgmlEncoding(header: string): OfxEncoding {
  const fields = new Map<string, string>();
  const allowed = ['OFXHEADER', 'DATA', 'VERSION', 'SECURITY', 'ENCODING', 'CHARSET', 'COMPRESSION', 'OLDFILEUID', 'NEWFILEUID'];
  for (const line of header.trim().split(/\r\n|\n|\r/)) {
    if (!line.trim()) continue;
    const match = /^\s*([A-Z]+)\s*:\s*([A-Za-z0-9_.-]+)\s*$/.exec(line);
    if (!match || !allowed.includes(match[1]) || fields.has(match[1])) invalidHeader();
    fields.set(match[1], match[2]);
  }
  if (fields.get('OFXHEADER') !== '100'
    || (fields.has('DATA') && fields.get('DATA') !== 'OFXSGML')
    || (fields.has('VERSION') && !/^1\d\d$/.test(fields.get('VERSION')!))) invalidHeader();
  if ((fields.has('COMPRESSION') && fields.get('COMPRESSION') !== 'NONE')
    || (fields.has('SECURITY') && fields.get('SECURITY') !== 'NONE')) {
    throw new Error('OFX comprimido ou protegido exige importador específico.');
  }
  const charset = fields.get('CHARSET');
  const hasCharset = charset != null && charset !== 'NONE';
  // Sem declaração, só ASCII é inequívoco no SGML; não adivinhar Windows-1252.
  if (!fields.has('ENCODING')) {
    if (hasCharset) invalidHeader();
    return 'ascii';
  }
  const encoding = encodingFor(fields.get('ENCODING')!);
  if (!hasCharset) return encoding;
  const charsetEncoding = encodingFor(charset);
  // OFX 1 usa USASCII + CHARSET:1252 para o repertório de página de código.
  // Referência OFX 2.3: §§2.8.2–2.8.3 e exemplo 16.5.4.2 (link em ofxStatement).
  if (encoding === 'ascii' && ['ascii', 'windows-1252', 'iso-8859-1'].includes(charsetEncoding)) return charsetEncoding;
  if (encoding !== charsetEncoding) invalidHeader();
  return encoding;
}

/** Decodifica sem fallback heurístico; a única alteração nos bytes é retirar o BOM UTF-8. */
export function decodeOfxBytes(bytes: Uint8Array): string {
  checkSize(bytes.byteLength);
  // UTF-16/32 não são lidos como ASCII nem convertidos parcialmente por acidente.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
    || (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff)) {
    throw new Error('Codificação OFX UTF-16/UTF-32 não suportada. Exporte em UTF-8.');
  }
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const payload = bytes.subarray(hasBom ? 3 : 0);
  const prefix = String.fromCharCode(...payload.subarray(0, MAX_HEADER_BYTES + 5));
  const rootIndex = prefix.indexOf('<OFX>');
  if (rootIndex < 0 || rootIndex > MAX_HEADER_BYTES) {
    throw new Error('Cabeçalho OFX ausente, inválido ou acima do limite de 16 KiB.');
  }
  const header = prefix.slice(0, rootIndex);
  if (/[^\t\r\n\x20-\x7e]/.test(header)) invalidHeader();
  const encoding = /^\s*OFXHEADER\s*:/.test(header) ? sgmlEncoding(header) : xmlEncoding(header);
  if (hasBom && encoding !== 'utf-8') {
    throw new Error('BOM UTF-8 contradiz a codificação declarada no OFX. Exporte novamente o arquivo.');
  }
  if (encoding === 'ascii' && payload.some(byte => byte > 0x7f)) {
    throw new Error('OFX declara ASCII, mas contém bytes de outra codificação. Exporte novamente o arquivo.');
  }
  let text: string;
  if (encoding === 'iso-8859-1') {
    // TextDecoder("iso-8859-1") usa Windows-1252 nos navegadores. Não trocar
    // silenciosamente os bytes 0x80–0x9f por símbolos de outra página de código.
    const chunks: string[] = [];
    for (let offset = 0; offset < payload.length; offset += 8192) {
      chunks.push(String.fromCharCode(...payload.subarray(offset, offset + 8192)));
    }
    text = chunks.join('');
  } else {
    try {
      text = new TextDecoder(encoding === 'ascii' ? 'utf-8' : encoding, { fatal: true, ignoreBOM: true }).decode(payload);
    } catch {
      throw new Error('Bytes inválidos para a codificação declarada no OFX. Nenhum caractere foi substituído.');
    }
  }
  // C1 inclui os bytes indefinidos do Windows-1252. U+FFFD indica texto já
  // corrompido na origem; uma segunda assinatura BOM não é um cabeçalho válido.
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13)
      || (code >= 127 && code <= 159) || code === 0xfffd || code === 0xfeff) {
      throw new Error('OFX contém caracteres de controle, assinatura repetida ou texto corrompido. Exporte novamente o arquivo.');
    }
  }
  return text;
}

/** Lê um arquivo local; não grava extratos, não concilia e não baixa títulos. */
export async function readOfxFile(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<OfxStatement[]> {
  const size = file.size;
  checkSize(size);
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error('Não foi possível ler o arquivo OFX. Selecione novamente o arquivo do banco.');
  }
  if (buffer.byteLength !== size) throw new Error('O tamanho lido do OFX difere do arquivo selecionado. Nenhuma linha foi importada.');
  return parseOfxStatements(decodeOfxBytes(new Uint8Array(buffer)));
}

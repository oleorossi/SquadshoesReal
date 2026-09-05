import { describe, expect, it, vi } from 'vitest';
import { decodeOfxBytes, MAX_OFX_FILE_BYTES, readOfxFile } from '@/lib/ofxFileImport';

// Extratos inteiramente sintéticos; os testes passam bytes, não texto já decodificado.
const utf8 = (text: string) => new TextEncoder().encode(text);
const body = (name = 'Aviamentos', memo = 'Insumos') => `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL</CURDEF><BANKACCTFROM><BANKID>000</BANKID><ACCTID>000001</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260901</DTPOSTED><TRNAMT>-12.34</TRNAMT>
<FITID>0000007</FITID><NAME>${name}</NAME><MEMO>${memo}</MEMO></STMTTRN></BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const xml = (encoding = 'UTF-8', name = 'Aviamentos', memo = 'Insumos') => `<?xml version="1.0" encoding="${encoding}"?>
<?OFX OFXHEADER="200" VERSION="230" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
${body(name, memo)}`;
const sgml = (encoding = 'USASCII', charset = '1252', name = 'Aviamentos', memo = 'Insumos') => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:${encoding}
CHARSET:${charset}
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

${body(name, memo)}`;
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};
const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
const latin1 = (text: string) => Uint8Array.from(Array.from(text, character => {
  const code = character.charCodeAt(0);
  if (code > 255) throw new Error('Fixture contém caractere fora do Latin-1.');
  return code;
}));
const windows1252 = (text: string) => Uint8Array.from(Array.from(text, character => {
  const special: Record<string, number> = { '€': 0x80, '“': 0x93, '”': 0x94, '–': 0x96 };
  if (special[character] != null) return special[character];
  const code = character.charCodeAt(0);
  if (code > 255) throw new Error('Fixture contém caractere sem mapeamento Windows-1252.');
  return code;
}));
const localFile = (bytes: Uint8Array) => ({
  size: bytes.byteLength,
  arrayBuffer: vi.fn(async () => bytes.slice().buffer as ArrayBuffer),
});

describe('OFX — decodificação dos bytes', () => {
  it('preserva acentos e símbolos do Windows-1252 declarado pelo SGML', async () => {
    const bytes = windows1252(sgml('USASCII', '1252', 'São João “Calçados”', 'Napa – R$ 12,34 / €'));
    expect(bytes).toContain(0xe3);
    expect(bytes).toContain(0x93);
    expect(bytes).toContain(0x80);
    expect(decodeOfxBytes(bytes)).toContain('São João “Calçados”');
    const [statement] = await readOfxFile(localFile(bytes));
    expect(statement.account.accountId).toBe('000001');
    expect(statement.transactions[0]).toMatchObject({
      name: 'São João “Calçados”', memo: 'Napa – R$ 12,34 / €', amountCents: -1234, fitId: '0000007',
    });
  });

  it('integra bytes 1252 e folhas SGML sem fechamento ao parser existente', async () => {
    const raw = sgml('USASCII', '1252', 'Peças &amp; Cia', 'Forração').replace(
      /<\/(CURDEF|BANKID|ACCTID|ACCTTYPE|TRNTYPE|DTPOSTED|TRNAMT|FITID|NAME|MEMO)>/g, '',
    );
    expect((await readOfxFile(localFile(windows1252(raw))))[0].transactions[0]).toMatchObject({
      name: 'Peças & Cia', memo: 'Forração', amountCents: -1234,
    });
  });

  it.each(['UTF-8', 'utf-8', 'UTF8', '65001'])('aceita XML declarado como %s sem alterar UTF-8', encoding => {
    const raw = xml(encoding, 'São João', 'Couro 🥿');
    expect(decodeOfxBytes(utf8(raw))).toBe(raw);
  });

  it('retira uma assinatura UTF-8 e preserva o restante do documento', async () => {
    const raw = xml('UTF-8', 'São João');
    const bytes = concat(bom, utf8(raw));
    expect(decodeOfxBytes(bytes)).toBe(raw);
    expect((await readOfxFile(localFile(bytes)))[0].transactions[0].name).toBe('São João');
  });

  it.each([body('São João'), '<?xml version="1.0"?>' + body('São João')])('usa UTF-8 padrão no XML sem encoding', raw => {
    expect(decodeOfxBytes(utf8(raw))).toBe(raw);
    expect(decodeOfxBytes(concat(bom, utf8(raw)))).toBe(raw);
  });

  it.each(['NONE', 'UTF-8', '65001'])('aceita OFX 1 UTF-8 com CHARSET %s consistente', charset => {
    const raw = sgml('UTF-8', charset, 'Forração');
    expect(decodeOfxBytes(utf8(raw))).toBe(raw);
    expect(decodeOfxBytes(concat(bom, utf8(raw)))).toBe(raw);
  });

  it.each(['USASCII', 'US-ASCII', 'ASCII'])('aceita %s somente para bytes ASCII', encoding => {
    const raw = xml(encoding);
    expect(decodeOfxBytes(utf8(raw))).toBe(raw);
    expect(() => decodeOfxBytes(latin1(xml(encoding, 'São João')))).toThrow('declara ASCII');
    expect(() => decodeOfxBytes(utf8(xml(encoding, 'São João')))).toThrow('declara ASCII');
  });

  it.each(['WINDOWS-1252', 'CP1252', '1252'])('honra a declaração XML %s', encoding => {
    const raw = xml(encoding, 'Calçados “Azul”');
    expect(decodeOfxBytes(windows1252(raw))).toBe(raw);
  });

  it.each(['ISO-8859-1', 'LATIN1', '28591'])('honra Latin-1 %s sem convertê-lo implicitamente em 1252', encoding => {
    const raw = xml(encoding, 'Peças e forração');
    expect(decodeOfxBytes(latin1(raw))).toBe(raw);
    expect(() => decodeOfxBytes(latin1(xml(encoding, 'Símbolo \u0080')))).toThrow('caracteres de controle');
  });

  it('aceita CRLF e CR nos cabeçalhos legados', () => {
    expect(decodeOfxBytes(windows1252(sgml().replace(/\n/g, '\r\n')))).toContain('OFXHEADER:100\r\n');
    expect(decodeOfxBytes(windows1252(sgml().replace(/\n/g, '\r')))).toContain('OFXHEADER:100\r');
  });

  it('não usa texto de MEMO/NAME como declaração de codificação', () => {
    const raw = xml('UTF-8', 'São João', 'ENCODING:ASCII CHARSET:1252 encoding=errado');
    expect(decodeOfxBytes(utf8(raw))).toBe(raw);
  });

  it('mantém uma declaração explícita sem adivinhar uma segunda codificação', () => {
    // Os bytes C3 A9 são válidos em ambas as codificações. O cabeçalho é a
    // evidência; não é possível detectar toda declaração incorreta pela aparência.
    const raw = xml('Windows-1252', 'Ã©');
    expect(decodeOfxBytes(windows1252(raw))).toBe(raw);
  });

  it('respeita os limites da view recebida, sem decodificar o ArrayBuffer inteiro', () => {
    const raw = xml('UTF-8', 'Forração');
    const encoded = utf8(raw);
    const surrounding = concat(new Uint8Array([0xff, 0xfe]), encoded, new Uint8Array([0xff]));
    expect(decodeOfxBytes(surrounding.subarray(2, 2 + encoded.byteLength))).toBe(raw);
  });
});

describe('OFX — arquivos inconsistentes não recebem fallback', () => {
  it.each([
    [0xc3], [0xc3, 0x28], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
  ])('rejeita uma sequência UTF-8 inválida %j', (...invalid) => {
    const raw = xml().replace('Aviamentos', 'BYTE_TESTE');
    const [before, after] = raw.split('BYTE_TESTE');
    expect(() => decodeOfxBytes(concat(utf8(before), new Uint8Array(invalid), utf8(after)))).toThrow('Bytes inválidos');
  });

  it('recusa Latin-1 não declarado em vez de tentar uma leitura alternativa', () => {
    expect(() => decodeOfxBytes(latin1(body('Forração')))).toThrow('Bytes inválidos');
  });

  it('aceita legado sem ENCODING somente quando todo o conteúdo é ASCII', () => {
    const raw = 'OFXHEADER:100\nVERSION:102\n' + body();
    expect(decodeOfxBytes(utf8(raw))).toBe(raw);
    expect(() => decodeOfxBytes(utf8(raw.replace('Aviamentos', 'Forração')))).toThrow('declara ASCII');
    expect(() => decodeOfxBytes(windows1252(raw.replace('Aviamentos', 'Forração')))).toThrow('declara ASCII');
  });

  it.each([
    ['BOM e 1252', concat(bom, windows1252(sgml())), 'BOM UTF-8 contradiz'],
    ['BOM e ASCII', concat(bom, utf8(xml('ASCII'))), 'BOM UTF-8 contradiz'],
    ['BOM repetido', concat(bom, bom, utf8(xml())), 'Cabeçalho OFX'],
    ['UTF-16LE', new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x4f, 0x00]), 'UTF-16/UTF-32'],
    ['UTF-16BE', new Uint8Array([0xfe, 0xff, 0x00, 0x3c, 0x00, 0x4f]), 'UTF-16/UTF-32'],
    ['UTF-32LE', new Uint8Array([0xff, 0xfe, 0x00, 0x00]), 'UTF-16/UTF-32'],
    ['UTF-32BE', new Uint8Array([0x00, 0x00, 0xfe, 0xff]), 'UTF-16/UTF-32'],
    ['UTF-16 sem BOM', new Uint8Array([0x3c, 0x00, 0x4f, 0x00, 0x46, 0x00, 0x58, 0x00, 0x3e, 0x00]), 'Cabeçalho OFX'],
  ])('rejeita %s explicitamente', (_, bytes, message) => {
    expect(() => decodeOfxBytes(bytes)).toThrow(message);
  });

  it.each([0x81, 0x8d, 0x8f, 0x90, 0x9d])('rejeita byte indefinido 1252: %d', byte => {
    const raw = sgml().replace('Aviamentos', String.fromCharCode(byte));
    expect(() => decodeOfxBytes(latin1(raw))).toThrow(/caracteres de controle|Bytes inválidos/);
  });

  it.each(['\u0000', '\u000b', '\u001a', '\u007f', '\u0085', '\ufffd', '\ufeff'])('rejeita controle/substituição no corpo %j', character => {
    expect(() => decodeOfxBytes(utf8(xml('UTF-8', `Nome${character}`)))).toThrow('caracteres de controle');
  });

  it.each([
    ['charset incompatível', sgml('UTF-8', '1252')],
    ['charset UTF-8 com USASCII', sgml('USASCII', '65001')],
    ['charset sem encoding', sgml().replace('ENCODING:USASCII\n', '')],
    ['encoding repetido igual', sgml().replace('ENCODING:USASCII', 'ENCODING:USASCII\nENCODING:USASCII')],
    ['charset repetido', sgml().replace('CHARSET:1252', 'CHARSET:1252\nCHARSET:65001')],
    ['encoding vazio', sgml().replace('ENCODING:USASCII', 'ENCODING:')],
    ['encoding XML repetido', xml().replace('encoding="UTF-8"', 'encoding="UTF-8" encoding="Windows-1252"')],
    ['XML sem aspas', xml().replace('encoding="UTF-8"', 'encoding=UTF-8')],
    ['XML incompleto', xml().replace('encoding="UTF-8"?>', 'encoding="UTF-8">')],
    ['declaração XML duplicada', '<?xml version="1.0"?>' + xml()],
    ['XML e SGML misturados', '<?xml version="1.0" encoding="UTF-8"?>' + sgml()],
    ['SGML e XML misturados', sgml().replace('<OFX>', '<?xml version="1.0" encoding="UTF-8"?><OFX>')],
    ['encoding indevido no PI OFX', xml().replace('OFXHEADER="200"', 'OFXHEADER="200" ENCODING="1252"')],
    ['PI duplicado', xml().replace('<OFX>', '<?OFX OFXHEADER="200"?><OFX>')],
    ['PI truncado', '<?OFX OFXHEADER="200">' + body()],
    ['header versão XML no SGML', sgml().replace('OFXHEADER:100', 'OFXHEADER:200')],
    ['DATA incompatível', sgml().replace('DATA:OFXSGML', 'DATA:OFXXML')],
    ['lixo antes do cabeçalho', 'texto qualquer\n' + xml()],
    ['cabeçalho com acento', sgml().replace('NEWFILEUID:NONE', 'NEWFILEUID:Não')],
  ])('rejeita %s sem ignorar a declaração problemática', (_, raw) => {
    expect(() => decodeOfxBytes(utf8(raw))).toThrow('Cabeçalho OFX');
  });

  it.each(['UTF-16', 'UTF-32', 'UNICODE', 'SHIFT_JIS', 'KOI8-R', 'NONE'])('rejeita codificação não suportada %s', encoding => {
    expect(() => decodeOfxBytes(utf8(xml(encoding)))).toThrow('Codificação OFX não suportada');
  });

  it.each([
    sgml().replace('COMPRESSION:NONE', 'COMPRESSION:GZIP'),
    sgml().replace('SECURITY:NONE', 'SECURITY:TYPE1'),
    xml().replace('SECURITY="NONE"', 'SECURITY="TYPE1"'),
  ])('não ignora conteúdo comprimido/protegido declarado', raw => {
    expect(() => decodeOfxBytes(utf8(raw))).toThrow('importador específico');
  });
});

describe('OFX — leitura limitada e sem resultado parcial', () => {
  it.each([0, -1, 1.5, NaN, Infinity, MAX_OFX_FILE_BYTES + 1])('valida tamanho %s antes de chamar arrayBuffer', async size => {
    const file = { size, arrayBuffer: vi.fn(async () => new ArrayBuffer(0)) };
    await expect(readOfxFile(file)).rejects.toThrow(/tamanho inválido|limite/);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('limita bytes mesmo quando o resultado decodificado caberia em 5 milhões de caracteres', () => {
    const bytes = concat(utf8(xml('UTF-8', 'Forração')), new Uint8Array(MAX_OFX_FILE_BYTES).fill(32));
    expect(() => decodeOfxBytes(bytes)).toThrow('5.000.000 bytes');
  });

  it('aceita exatamente o limite de bytes e não altera o conteúdo', () => {
    const raw = xml();
    const exact = raw + ' '.repeat(MAX_OFX_FILE_BYTES - utf8(raw).byteLength);
    expect(decodeOfxBytes(utf8(exact))).toBe(exact);
  });

  it('aceita cabeçalho no limite de 16 KiB e bloqueia o byte seguinte', () => {
    expect(decodeOfxBytes(utf8(' '.repeat(16_384) + '<OFX></OFX>'))).toContain('<OFX>');
    expect(() => decodeOfxBytes(utf8(' '.repeat(16_385) + '<OFX></OFX>'))).toThrow('16 KiB');
  });

  it('confronta o tamanho real com o declarado para detectar leitura truncada', async () => {
    const bytes = utf8(xml());
    const file = { ...localFile(bytes), size: bytes.byteLength + 1 };
    await expect(readOfxFile(file)).rejects.toThrow('tamanho lido');
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it('não entrega dados se a leitura falhar', async () => {
    const file = { size: 100, arrayBuffer: vi.fn(async () => { throw new Error('Falha simulada de leitura.'); }) };
    await expect(readOfxFile(file)).rejects.toThrow('Não foi possível ler');
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it('propaga a validação completa do parser, não apenas a decodificação', async () => {
    await expect(readOfxFile(localFile(utf8(xml().replace('</STMTTRN>', ''))))).rejects.toThrow('malformada');
    await expect(readOfxFile(localFile(utf8(xml().replace('<TRNAMT>-12.34</TRNAMT>', '<TRNAMT>12,34</TRNAMT>'))))).rejects.toThrow('Valor OFX inválido');
    await expect(readOfxFile(localFile(utf8(xml().replace('<CURDEF>BRL</CURDEF>', '<CURDEF>USD</CURDEF>'))))).rejects.toThrow('somente extratos em BRL');
  });

  it('lê o arquivo uma única vez e não modifica os bytes originais', async () => {
    const bytes = concat(bom, utf8(xml('UTF-8', 'Calçados')));
    const initial = bytes.slice();
    const file = localFile(bytes);
    await readOfxFile(file);
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(bytes).toEqual(initial);
  });
});

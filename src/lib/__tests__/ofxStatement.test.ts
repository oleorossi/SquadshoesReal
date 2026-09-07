import { describe, expect, it } from 'vitest';
import { ofxAccountKey, ofxAmountCents, ofxPostedDate, parseOfxStatements } from '@/lib/ofxStatement';

// Documentos sintéticos, sem extratos nem números de conta reais.
// Montar delimitadores evita o scanner Tailwind interpretar o fuso como classe.
const zone = (value: string) => `[${value}]`;
const transaction = (fitId = '00001234', amount = '-1234.56', extra = '') => `<STMTTRN>
  <TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260831233000.000${zone('-3:BRT')}</DTPOSTED>
  <TRNAMT>${amount}</TRNAMT><FITID>${fitId}</FITID><NAME>Teste &amp; Cia</NAME><MEMO>Insumos</MEMO>${extra}
</STMTTRN>`;
const statement = (rows = transaction(), account = '000001', extra = '') => `<STMTRS>
  <CURDEF>BRL</CURDEF><BANKACCTFROM><BANKID>000</BANKID><BRANCHID>0001</BRANCHID>
    <ACCTID>${account}</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
  <BANKTRANLIST><DTSTART>20260801</DTSTART><DTEND>20260901</DTEND>${rows}</BANKTRANLIST>
  <LEDGERBAL><BALAMT>9876.54</BALAMT><DTASOF>20260901000000${zone('-3:BRT')}</DTASOF></LEDGERBAL>${extra}
</STMTRS>`;
const file = (statements = statement()) => `<?xml version="1.0" encoding="UTF-8"?>
  <?OFX OFXHEADER="200" VERSION="230" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
  <OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
  <FI><ORG>BANCO DE TESTE</ORG><FID>000</FID></FI></SONRS></SIGNONMSGSRSV1>
  <BANKMSGSRSV1><STMTTRNRS><TRNUID>0</TRNUID><STATUS><CODE>0</CODE></STATUS>${statements}</STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('OFX — documento e identidade bancária', () => {
  it('lê XML, mantém centavos/sinal/data bancária/zeros à esquerda e decodifica entidades', () => {
    const [result] = parseOfxStatements(file());
    expect(result.account).toMatchObject({ bankId: '000', branchId: '0001', accountId: '000001', currency: 'BRL' });
    expect(result.transactions).toEqual([{
      fitId: '00001234', postedDate: '2026-08-31', postedAtRaw: `20260831233000.000${zone('-3:BRT')}`,
      amountCents: -123456, type: 'DEBIT', name: 'Teste & Cia', memo: 'Insumos', checkNumber: '', referenceNumber: '',
    }]);
    expect(result.balance).toEqual({ amountCents: 987654, asOfDate: '2026-09-01', asOfRaw: `20260901000000${zone('-3:BRT')}` });
  });

  it('lê SGML com folhas sem fechamento e preserva agregados/ampersand', () => {
    const sgml = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nENCODING:USASCII\nCHARSET:1252\n\n`
      + file().slice(file().indexOf('<OFX>')).replace(/<\/(CURDEF|BANKID|BRANCHID|ACCTID|ACCTTYPE|DTSTART|DTEND|TRNTYPE|DTPOSTED|TRNAMT|FITID|NAME|MEMO|BALAMT|DTASOF|CODE|SEVERITY|ORG|FID|TRNUID)>/g, '').replace('&amp;', '&');
    expect(parseOfxStatements(sgml)).toEqual(parseOfxStatements(file()));
  });

  it('não usa TRNTYPE para inverter o sinal nem descrição para deduplicar', () => {
    const [result] = parseOfxStatements(file(statement(transaction('a', '100') + transaction('b', '100'))));
    expect(result.transactions.map(row => row.amountCents)).toEqual([10000, 10000]);
  });

  it('deduplica FITID idêntico somente dentro da mesma conta', () => {
    const results = parseOfxStatements(file(statement(transaction() + transaction()) + statement(transaction(), '000002')));
    expect(results.map(result => result.transactions.length)).toEqual([1, 1]);
    expect(results[0].duplicateCount).toBe(1);
    expect(ofxAccountKey(results[0].account)).not.toBe(ofxAccountKey(results[1].account));
  });

  it('rejeita FITID duplicado com conteúdo divergente em vez de escolher um valor', () => {
    expect(() => parseOfxStatements(file(statement(transaction('a', '-10') + transaction('a', '-20'))))).toThrow('conteúdo divergente');
  });

  it('rejeita identidade ambígua quando só uma ocorrência informa agência', () => {
    const noBranch = statement().replace('<BRANCHID>0001</BRANCHID>', '');
    expect(() => parseOfxStatements(file(statement() + noBranch))).toThrow('Agência ausente');
    expect(() => parseOfxStatements(file(noBranch + statement()))).toThrow('Agência ausente');
    const otherBranch = statement().replace('<BRANCHID>0001</BRANCHID>', '<BRANCHID>0002</BRANCHID>');
    expect(parseOfxStatements(file(statement() + otherBranch)).map(result => result.transactions.length)).toEqual([1, 1]);
  });

  it('aceita somente saldo sem lista, mas rejeita extrato sem ambas as informações', () => {
    const balanceOnly = statement('').replace(/<BANKTRANLIST>[\s\S]*?<\/BANKTRANLIST>/, '');
    expect(parseOfxStatements(file(balanceOnly))[0].transactions).toEqual([]);
    expect(() => parseOfxStatements(file(balanceOnly.replace(/<LEDGERBAL>[\s\S]*?<\/LEDGERBAL>/, '')))).toThrow('sem saldo');
  });

  it('tolera entidades em maiúsculas no SGML sem alterar o XML estrito', () => {
    const sgml = 'OFXHEADER:100\nVERSION:102\n' + file().slice(file().indexOf('<OFX>')).replace('&amp;', '&AMP;');
    expect(parseOfxStatements(sgml)[0].transactions[0].name).toBe('Teste & Cia');
    expect(() => parseOfxStatements(file().replace('&amp;', '&AMP;'))).toThrow('malformada');
  });

  it('não inclui pendências no realizado, mas informa a existência delas', () => {
    const pending = '<BANKTRANLISTP><STMTTRNP><TRNAMT>-100</TRNAMT></STMTTRNP></BANKTRANLISTP>';
    const [result] = parseOfxStatements(file(statement('', '000001', pending)));
    expect(result.transactions).toEqual([]);
    expect(result.pendingCount).toBe(1);
  });

  it('aceita extrato sem movimentação e mantém o saldo apenas como dado do documento', () => {
    expect(parseOfxStatements(file(statement('')))[0].transactions).toEqual([]);
  });

  it('lê conta de cartão em BRL sem tratar compras como entradas', () => {
    const card = '<CCSTMTRS><CURDEF>BRL</CURDEF><CCACCTFROM><ACCTID>CARTAO-TESTE</ACCTID></CCACCTFROM>'
      + `<BANKTRANLIST>${transaction('compra', '-100')}${transaction('pagamento', '100')}</BANKTRANLIST></CCSTMTRS>`;
    const [result] = parseOfxStatements(file(card));
    expect(result.account.kind).toBe('credit-card');
    expect(result.transactions.map(row => row.amountCents)).toEqual([-10000, 10000]);
  });

  it.each([
    ['chave ausente', file().replace('<FITID>00001234</FITID>', ''), 'FITID'],
    ['valor duplicado', file().replace('<TRNAMT>-1234.56</TRNAMT>', '<TRNAMT>1</TRNAMT><TRNAMT>2</TRNAMT>'), 'TRNAMT'],
    ['conta ausente', file().replace('<ACCTID>000001</ACCTID>', ''), 'ACCTID'],
    ['XML truncado', file().replace('</STMTTRN>', ''), 'malformada'],
    ['erro do banco', file().replace('<CODE>0</CODE>', '<CODE>2000</CODE>'), 'erro do banco'],
    ['DTD', '<!DOCTYPE OFX [<!ENTITY x SYSTEM "file:///secret">]>' + file(), 'entidades externas'],
    ['moeda não suportada', file().replace('<CURDEF>BRL</CURDEF>', '<CURDEF>USD</CURDEF>'), 'somente extratos em BRL'],
    ['câmbio por transação', file(statement(transaction('a', '10', '<ORIGCURRENCY><CURSYM>USD</CURSYM></ORIGCURRENCY>'))), 'cambial'],
    ['correção de movimento', file(statement(transaction('novo', '10', '<CORRECTFITID>antigo</CORRECTFITID><CORRECTACTION>DELETE</CORRECTACTION>'))), 'revisão'],
    ['investimento', file('<INVSTMTRS/>'), 'importador específico'],
    ['movimento fora da lista', file(statement('', '000001', transaction())), 'fora da lista'],
    ['texto comum', '01/09/2026;PIX;100', 'não contém'],
  ])('bloqueia %s sem entregar um extrato parcial', (_, content, reason) => {
    expect(() => parseOfxStatements(content)).toThrow(reason);
  });
});

describe('OFX — valores e datas', () => {
  it.each([['0', 0], ['-0.00', 0], ['+1234.5', 123450], ['0.0100', 1], ['-0.01', -1]])('converte %s em centavos exatos', (raw, cents) => {
    expect(ofxAmountCents(raw)).toBe(cents);
  });
  it.each(['1,00', '1.234,56', '1e3', 'Infinity', 'NaN', '', '0.001', '9007199254740993'])('rejeita valor %s', raw => {
    expect(() => ofxAmountCents(raw)).toThrow();
  });
  it.each(['20260831', '20260831233000', `20260831233000.001${zone('-3:BRT')}`, `20260831003000${zone('5.5:IST')}`])('preserva data civil em %s', raw => {
    expect(ofxPostedDate(raw)).toBe('2026-08-31');
  });
  it.each(['20260229', '20261301', '20260431', '20260101240000', '20260101006100', `20260101000000${zone('15:X')}`, 'ontem', '2026-09-05'])('rejeita data %s', raw => {
    expect(() => ofxPostedDate(raw)).toThrow();
  });
  it('valida ano bissexto', () => expect(ofxPostedDate('20240229')).toBe('2024-02-29'));
});

/**
 * Leitor de extratos bancários/cartão OFX 1 (SGML) e 2 (XML), sem efeitos financeiros.
 * Contrato: https://financialdataexchange.org/wp-content/uploads/2025/12/OFX-Banking-Specification-v2.3.pdf
 * Seções 3.2.8, 11.4.2–11.4.4. FITID é identidade, não descrição/data/valor.
 * Este leitor não baixa títulos: persistência idempotente e confirmação são outra fronteira.
 */
export interface OfxAccount {
  kind: 'bank' | 'credit-card';
  bankId: string;
  branchId: string;
  accountId: string;
  accountType: string;
  currency: string;
  institutionId: string;
}

export interface OfxTransaction {
  fitId: string;
  postedDate: string;
  postedAtRaw: string;
  amountCents: number;
  type: string;
  name: string;
  memo: string;
  checkNumber: string;
  referenceNumber: string;
}

export interface OfxStatement {
  account: OfxAccount;
  transactions: OfxTransaction[];
  balance: { amountCents: number; asOfDate: string; asOfRaw: string } | null;
  pendingCount: number;
  duplicateCount: number;
}

const MAX_FILE_CHARS = 5_000_000;
const MAX_TRANSACTIONS = 50_000;

/** Centavos inteiros: nunca interpreta vírgula/milhar nem arredonda silenciosamente. */
export function ofxAmountCents(raw: string): number {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw.trim());
  if (!match || (match[3]?.slice(2).replace(/0/g, '') || '').length > 0) {
    throw new Error('Valor OFX inválido ou com fração de centavo. Confira o arquivo do banco.');
  }
  const cents = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0').slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error('Valor OFX excede o limite de cálculo seguro.');
  return cents === 0 ? 0 : (match[1] === '-' ? -cents : cents);
}

/** Mantém o dia informado pelo banco; o timestamp original acompanha a evidência. */
export function ofxPostedDate(raw: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.\d{1,3})?)?(?:\s*\[([+-]?\d{1,2}(?:\.\d{1,2})?)(?::[^\]\r\n]+)?\])?$/.exec(raw.trim());
  if (!match) throw new Error('Data OFX inválida. Não foi usada a data de hoje como substituição.');
  const [, year, month, day, hour, minute, second, offset] = match;
  const civil = `${year}-${month}-${day}`;
  const parsed = new Date(`${civil}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== civil
    || (hour != null && (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 60))
    || (offset != null && Math.abs(Number(offset)) > 12)) {
    throw new Error('Data ou horário OFX fora dos limites válidos.');
  }
  return civil;
}

function child(parent: Element, tag: string, required = false): Element | null {
  const matches = Array.from(parent.children).filter(element => element.tagName === tag);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    throw new Error(`Estrutura OFX inválida: campo ${tag} ausente ou repetido.`);
  }
  return matches[0] || null;
}

function value(parent: Element, tag: string, required = false): string {
  const element = child(parent, tag, required);
  if (element?.children.length) throw new Error(`Campo OFX ${tag} contém estrutura inesperada.`);
  const result = element?.textContent?.trim() || '';
  if ((required && !result) || result.length > 2048) {
    throw new Error(`Campo OFX ${tag} vazio ou acima do tamanho permitido.`);
  }
  return result;
}

function parseDocument(raw: string): Document {
  if (!raw || raw.length > MAX_FILE_CHARS) throw new Error('Arquivo OFX vazio ou maior que o limite de 5 milhões de caracteres.');
  // Não aceitar entidades externas, DTD ou conteúdo executável como parte do extrato.
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('OFX com DTD ou entidades externas não é aceito.');
  const start = raw.indexOf('<OFX>');
  if (start < 0) throw new Error('Arquivo não contém um extrato OFX reconhecido.');
  let xml = raw.slice(start).trim();
  if (/OFXHEADER\s*:\s*100/i.test(raw.slice(0, start))) {
    // OFX 1 omite o fechamento de folhas; agregados precisam permanecer balanceados.
    // A normalização não transforma um XML 2 malformado em arquivo aparentemente válido.
    xml = xml.replace(/<([A-Z][A-Z0-9_.]*)>([^<]+)/g, (whole, tag, text, index) => {
      if (!text.trim() || xml.slice(index + whole.length).startsWith(`</${tag}>`)) return whole;
      return `<${tag}>${text}</${tag}>`;
    }).replace(/&(?:amp|lt|gt|quot|apos);/gi, entity => entity.toLowerCase())
      .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g, '&amp;');
  }
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.tagName !== 'OFX') {
    throw new Error('Estrutura OFX incompleta ou malformada. Nenhuma linha foi importada.');
  }
  if (document.querySelector('INVSTMTRS, LOANSTMTRS')) {
    throw new Error('Extratos de investimentos/empréstimos exigem importador específico.');
  }
  for (const status of Array.from(document.querySelectorAll('STATUS'))) {
    if (value(status, 'CODE', true) !== '0') throw new Error('O arquivo OFX contém uma resposta de erro do banco.');
  }
  if (document.querySelector('CORRECTFITID, CORRECTACTION')) {
    throw new Error('O banco enviou correção de transação anterior. É necessária revisão antes de conciliar.');
  }
  return document;
}

/** Identidade composta sem concatenação ambígua; o cadastro bancário ainda deve ser confirmado. */
export function ofxAccountKey(account: OfxAccount): string {
  return JSON.stringify([account.kind, account.institutionId, account.bankId, account.branchId,
    account.accountId, account.accountType, account.currency]);
}

export function parseOfxStatements(raw: string): OfxStatement[] {
  const document = parseDocument(raw);
  const statements = Array.from(document.querySelectorAll('STMTRS, CCSTMTRS'));
  if (!statements.length) throw new Error('Nenhum extrato de conta bancária ou cartão foi encontrado.');
  const fi = document.querySelector('SONRS > FI');
  const institutionId = fi ? JSON.stringify([value(fi, 'ORG'), value(fi, 'FID')]) : '';
  const seen = new Map<string, OfxTransaction>();
  const branchEvidence = new Map<string, Set<string>>();
  let transactionCount = 0;
  const result = statements.map(statement => {
    const kind = statement.tagName === 'STMTRS' ? 'bank' : 'credit-card';
    const accountNode = child(statement, kind === 'bank' ? 'BANKACCTFROM' : 'CCACCTFROM', true)!;
    const account: OfxAccount = {
      kind,
      institutionId,
      bankId: value(accountNode, 'BANKID', kind === 'bank'),
      branchId: value(accountNode, 'BRANCHID'),
      accountId: value(accountNode, 'ACCTID', true),
      accountType: kind === 'bank' ? value(accountNode, 'ACCTTYPE', true) : 'CREDITCARD',
      currency: value(statement, 'CURDEF', true),
    };
    if (account.currency !== 'BRL') throw new Error('Esta importação financeira aceita somente extratos em BRL. Não houve conversão de moeda.');
    const list = child(statement, 'BANKTRANLIST');
    const balanceNode = child(statement, 'LEDGERBAL');
    if (!list && !balanceNode) throw new Error('Extrato sem lista de transações e sem saldo. Não foi presumido movimento zero.');
    const transactions: OfxTransaction[] = [];
    let duplicateCount = 0;
    for (const node of list ? Array.from(list.children).filter(element => element.tagName === 'STMTTRN') : []) {
      if (++transactionCount > MAX_TRANSACTIONS) throw new Error('Extrato excede o limite de 50 mil lançamentos.');
      // Valores em moeda diferente não podem parecer reais sem conversão auditada.
      if (child(node, 'CURRENCY') || child(node, 'ORIGCURRENCY')) throw new Error('Transação com conversão cambial exige revisão específica.');
      const postedAtRaw = value(node, 'DTPOSTED', true);
      const payee = child(node, 'PAYEE');
      const transaction: OfxTransaction = {
        fitId: value(node, 'FITID', true),
        postedDate: ofxPostedDate(postedAtRaw),
        postedAtRaw,
        amountCents: ofxAmountCents(value(node, 'TRNAMT', true)),
        type: value(node, 'TRNTYPE', true),
        name: value(node, 'NAME') || (payee ? value(payee, 'NAME') : ''),
        memo: value(node, 'MEMO'),
        checkNumber: value(node, 'CHECKNUM'),
        referenceNumber: value(node, 'REFNUM'),
      };
      // Ausência de agência não significa agência diferente. Evita aceitar duas
      // vezes o mesmo FITID quando uma ocorrência omite esse campo opcional;
      // também não junta silenciosamente contas de agências realmente distintas.
      const branchKey = JSON.stringify([account.kind, account.institutionId, account.bankId,
        account.accountId, account.accountType, account.currency, transaction.fitId]);
      const branches = branchEvidence.get(branchKey) || new Set<string>();
      if (branches.size && !branches.has(account.branchId) && (!account.branchId || branches.has(''))) {
        throw new Error('Agência ausente em uma ocorrência do mesmo FITID/conta. Confirme a identidade bancária antes de importar.');
      }
      branches.add(account.branchId);
      branchEvidence.set(branchKey, branches);
      const key = JSON.stringify([ofxAccountKey(account), transaction.fitId]);
      const previous = seen.get(key);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(transaction)) {
          throw new Error('FITID repetido na mesma conta com conteúdo divergente. Nenhum valor foi escolhido automaticamente.');
        }
        duplicateCount++;
      } else {
        seen.set(key, transaction);
        transactions.push(transaction);
      }
    }
    const asOfRaw = balanceNode ? value(balanceNode, 'DTASOF', true) : '';
    return {
      account, transactions, duplicateCount,
      pendingCount: child(statement, 'BANKTRANLISTP')?.querySelectorAll('STMTTRNP').length || 0,
      balance: balanceNode ? {
        amountCents: ofxAmountCents(value(balanceNode, 'BALAMT', true)),
        asOfDate: ofxPostedDate(asOfRaw), asOfRaw,
      } : null,
    };
  });
  if (transactionCount !== document.querySelectorAll('STMTTRN').length) {
    throw new Error('Transações OFX fora da lista da conta. Nenhuma linha foi ignorada silenciosamente.');
  }
  return result;
}

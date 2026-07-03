/**
 * Parser de boleto bancário / conta de concessionária a partir da
 * **linha digitável** (código digitável).
 *
 * Suporta os dois formatos brasileiros:
 *  - Boleto bancário de cobrança: 47 dígitos (linha digitável), 44 no código de barras.
 *  - Arrecadação / concessionária (água, luz, tributos): 48 dígitos, inicia com "8".
 *
 * A partir da linha digitável extraímos, quando disponível:
 *  - `barcode`   → código de barras (44 dígitos) reconstruído
 *  - `amount`    → valor em reais (R$)
 *  - `dueDate`   → data de vencimento (ISO yyyy-mm-dd) — só boleto bancário
 *  - `bankCode`  → código do banco (3 dígitos) — só boleto bancário
 *  - `bankName`  → nome do banco quando conhecido
 *
 * Referências: FEBRABAN — Layout de Cobrança / Arrecadação.
 */

export type BoletoKind = 'bancario' | 'concessionaria';

export interface ParsedBoleto {
  /** Linha digitável apenas com dígitos (47 ou 48). */
  digitableLine: string;
  /** Código de barras reconstruído (44 dígitos) — vazio se não foi possível. */
  barcode: string;
  kind: BoletoKind;
  /** Valor em reais; null quando o boleto não traz valor (campo zerado). */
  amount: number | null;
  /** Vencimento ISO (yyyy-mm-dd); null para concessionária ou fator zerado. */
  dueDate: string | null;
  bankCode: string | null;
  bankName: string | null;
  /** true quando os dígitos verificadores conferem. */
  valid: boolean;
}

/**
 * Mapa dos bancos mais comuns no Brasil (código COMPE → nome).
 * Lista curta e prática — o suficiente pra auto-preencher o campo "Banco".
 */
const BANK_NAMES: Record<string, string> = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '041': 'Banrisul',
  '070': 'BRB',
  '077': 'Banco Inter',
  '104': 'Caixa Econômica Federal',
  '121': 'Agibank',
  '208': 'BTG Pactual',
  '212': 'Banco Original',
  '237': 'Bradesco',
  '246': 'Banco ABC Brasil',
  '260': 'Nubank',
  '336': 'C6 Bank',
  '341': 'Itaú',
  '380': 'PicPay',
  '389': 'Banco Mercantil',
  '399': 'HSBC',
  '422': 'Banco Safra',
  '447': 'Banco Digio',
  '623': 'Banco PAN',
  '655': 'Banco Votorantim',
  '745': 'Citibank',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

export function bankNameFromCode(code: string | null): string | null {
  if (!code) return null;
  return BANK_NAMES[code] ?? null;
}

/** Remove tudo que não for dígito. */
function onlyDigits(s: string): string {
  return (s || '').replace(/\D/g, '');
}

/**
 * Procura uma linha digitável (47/48 dígitos) dentro de um texto livre —
 * tolerante a pontos, espaços e quebras que os PDFs de boleto costumam inserir.
 *
 * Estratégia: varre o texto agrupando runs de dígitos/separadores e tenta casar
 * uma sequência que, ao remover não-dígitos, dê 47 ou 48 dígitos.
 */
export function extractDigitableLine(text: string): string | null {
  if (!text) return null;

  // Candidatos: blocos com dígitos e separadores comuns de linha digitável.
  // Ex.: "34191.79001 01043.510047 91020.150008 4 84410026000"
  const blockRe = /[\d][\d.\s]{40,}[\d]/g;
  const matches = text.match(blockRe) || [];

  for (const raw of matches) {
    const digits = onlyDigits(raw);
    // Uma linha digitável tem exatamente 47 (bancário) ou 48 (concessionária).
    // Blocos maiores podem conter a linha + ruído: tenta janelas.
    if (digits.length === 47 || digits.length === 48) return digits;
  }

  // Fallback: junta todos os dígitos do texto e procura 47/48 em sequência
  // usando as âncoras conhecidas (concessionária começa com 8).
  const all = onlyDigits(text);
  // 48 dígitos iniciando com 8 (concessionária)
  const conc = all.match(/8\d{47}/);
  if (conc) return conc[0].slice(0, 48);

  return null;
}

/**
 * Base de cálculo do "fator de vencimento" (FEBRABAN).
 * Base histórica: 07/10/1997. Em 22/02/2025 o fator estourou 9999 e reiniciou
 * em 1000 — tratamos o rollover escolhendo a data plausível mais próxima de hoje.
 */
const FATOR_BASE_MS = Date.UTC(1997, 9, 7); // 1997-10-07
const DAY_MS = 86_400_000;
const CYCLE_DAYS = 9000; // ciclo do rollover (1000..9999)

function isoFromUTC(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Converte o fator de vencimento (4 dígitos) em data ISO, tratando o rollover
 * de 2025. Retorna null quando o fator é 0 (boleto sem vencimento definido).
 */
export function fatorVencimentoToDate(fator: number, nowMs: number = Date.now()): string | null {
  if (!fator || fator <= 0) return null;

  // Candidatos: a data base + fator, e os ciclos deslocados (rollover).
  const candidates: number[] = [];
  for (let k = 0; k <= 2; k++) {
    candidates.push(FATOR_BASE_MS + (fator + k * CYCLE_DAYS) * DAY_MS);
  }

  // Janela plausível: de ~5 anos atrás até ~7 anos à frente.
  const lower = nowMs - 5 * 365 * DAY_MS;
  const upper = nowMs + 7 * 365 * DAY_MS;

  const inWindow = candidates.filter((ms) => ms >= lower && ms <= upper);
  const pool = inWindow.length ? inWindow : candidates;
  // Escolhe o mais próximo de hoje.
  pool.sort((a, b) => Math.abs(a - nowMs) - Math.abs(b - nowMs));
  return isoFromUTC(pool[0]);
}

/** Dígito verificador Módulo 10 (usado nos campos da linha digitável). */
function mod10(num: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = parseInt(num[i], 10) * weight;
    if (d > 9) d = Math.floor(d / 10) + (d % 10);
    sum += d;
    weight = weight === 2 ? 1 : 2;
  }
  const rest = sum % 10;
  return rest === 0 ? 0 : 10 - rest;
}

/** Dígito verificador Módulo 11 (usado no DV geral do código de barras). */
function mod11Barcode(num: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += parseInt(num[i], 10) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const dv = 11 - rest;
  if (dv === 0 || dv === 10 || dv === 11) return 1;
  return dv;
}

/** Módulo 11 para concessionária (DV de cada bloco): resultado 0 ou 1. */
function mod11Conc(num: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += parseInt(num[i], 10) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const dv = 11 - rest;
  if (dv === 10) return 0;
  if (dv === 11) return 1;
  return dv;
}

function parseBancario(line: string, nowMs: number): ParsedBoleto {
  // Campos da linha digitável (47 dígitos):
  //  Campo1: pos 0..9   (10) → AAABC CCCCC + DV
  //  Campo2: pos 10..20 (11) → 10 dígitos + DV
  //  Campo3: pos 21..31 (11) → 10 dígitos + DV
  //  Campo4: pos 32     (1)  → DV geral do código de barras
  //  Campo5: pos 33..46 (14) → fator(4) + valor(10)
  const c1 = line.slice(0, 10);
  const c2 = line.slice(10, 21);
  const c3 = line.slice(21, 32);
  const dvGeral = line.slice(32, 33);
  const c5 = line.slice(33, 47);

  const dv1ok = mod10(c1.slice(0, 9)) === parseInt(c1[9], 10);
  const dv2ok = mod10(c2.slice(0, 10)) === parseInt(c2[10], 10);
  const dv3ok = mod10(c3.slice(0, 10)) === parseInt(c3[10], 10);

  // Reconstrói o código de barras (44 dígitos):
  // banco(3) moeda(1) DVgeral(1) fator(4) valor(10) campoLivre(25)
  const bankCode = c1.slice(0, 3);
  const currency = c1.slice(3, 4);
  const fatorStr = c5.slice(0, 4);
  const valorStr = c5.slice(4, 14);
  const campoLivre = c1.slice(4, 9) + c2.slice(0, 10) + c3.slice(0, 10);
  const barcode = bankCode + currency + dvGeral + fatorStr + valorStr + campoLivre;

  const dvGeralOk = mod11Barcode(barcode.slice(0, 4) + barcode.slice(5)) === parseInt(dvGeral, 10);

  const fator = parseInt(fatorStr, 10);
  const valorCents = parseInt(valorStr, 10);
  const amount = valorCents > 0 ? valorCents / 100 : null;
  const dueDate = fatorVencimentoToDate(fator, nowMs);

  return {
    digitableLine: line,
    barcode,
    kind: 'bancario',
    amount,
    dueDate,
    bankCode,
    bankName: bankNameFromCode(bankCode),
    valid: dv1ok && dv2ok && dv3ok && dvGeralOk,
  };
}

function parseConcessionaria(line: string): ParsedBoleto {
  // 48 dígitos, 4 blocos de 12 (11 + DV cada). Início "8".
  // Código de barras = concatenação dos 11 dígitos de cada bloco (44).
  const blocks = [
    line.slice(0, 12),
    line.slice(12, 24),
    line.slice(24, 36),
    line.slice(36, 48),
  ];
  let barcode = '';
  let valid = true;
  for (const b of blocks) {
    const body = b.slice(0, 11);
    const dv = parseInt(b[11], 10);
    if (mod10(body) !== dv && mod11Conc(body) !== dv) valid = false;
    barcode += body;
  }

  // Identificador de valor (pos 3 do barcode): 6/7 = valor em reais (10 dígitos, pos 4..14).
  const valorStr = barcode.slice(4, 15);
  const valorCents = parseInt(valorStr, 10);
  const amount = valorCents > 0 ? valorCents / 100 : null;

  return {
    digitableLine: line,
    barcode,
    kind: 'concessionaria',
    amount,
    dueDate: null, // concessionária não codifica vencimento no padrão
    bankCode: null,
    bankName: null,
    valid,
  };
}

/**
 * Decodifica uma linha digitável (com ou sem máscara) em dados estruturados.
 * Lança erro se a linha não tiver 47/48 dígitos.
 */
export function parseDigitableLine(input: string, nowMs: number = Date.now()): ParsedBoleto {
  const line = onlyDigits(input);
  if (line.length === 48 && line.startsWith('8')) {
    return parseConcessionaria(line);
  }
  if (line.length === 47) {
    return parseBancario(line, nowMs);
  }
  throw new Error(`Linha digitável inválida: esperado 47 ou 48 dígitos, recebido ${line.length}.`);
}

/**
 * Formata a linha digitável para exibição (com a máscara padrão do boleto).
 */
export function formatDigitableLine(input: string): string {
  const d = onlyDigits(input);
  if (d.length === 47) {
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33)}`;
  }
  if (d.length === 48) {
    return `${d.slice(0, 12)} ${d.slice(12, 24)} ${d.slice(24, 36)} ${d.slice(36, 48)}`;
  }
  return input;
}

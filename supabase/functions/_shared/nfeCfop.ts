/**
 * CFOP da NF-e de saída da indústria de calçados.
 *
 * Squad Shoes é indústria (produção própria) no Simples Nacional.
 * A tela de tributação grava 4 CFOPs; a emissão escolhe pela origem do item
 * (ficha = indústria, avulso = revenda) e pela UF do destinatário.
 *
 * Migration 20260614120000. Não inferir CFOP por fotografia — só estas colunas.
 */

export type NfeCfopKind = 'industrial' | 'revenda';

export interface NfeCfopFiscal {
  cfop?: string | null;
  cfop_industrial_interno?: string | null;
  cfop_industrial_externo?: string | null;
  cfop_revenda_interno?: string | null;
  cfop_revenda_externo?: string | null;
}

const CFOP_RE = /^[56]\d{3}$/;

function normalizeCfop(raw: unknown): string {
  return String(raw ?? '').trim();
}

function pickCfop(raw: unknown, fallback: string): string {
  const value = normalizeCfop(raw);
  return CFOP_RE.test(value) ? value : fallback;
}

function flipUf(cfop: string, isInterstate: boolean): string {
  if (isInterstate && cfop.startsWith('5')) return `6${cfop.slice(1)}`;
  if (!isInterstate && cfop.startsWith('6')) return `5${cfop.slice(1)}`;
  return cfop;
}

export function assertNfeCfopColumns(fiscal: NfeCfopFiscal): void {
  const fields: Array<keyof NfeCfopFiscal> = [
    'cfop',
    'cfop_industrial_interno',
    'cfop_industrial_externo',
    'cfop_revenda_interno',
    'cfop_revenda_externo',
  ];
  for (const field of fields) {
    const value = normalizeCfop(fiscal[field]);
    if (value && !CFOP_RE.test(value)) {
      throw new Error(
        `CFOP configurado inválido (${field}): "${value}". Use 4 dígitos começando em 5 (intra) ou 6 (inter).`,
      );
    }
  }
}

/** Ficha técnica = produção da indústria. Item avulso (só produto) = revenda. */
export function classifyNfeItemOrigin(item: {
  technical_sheets?: unknown;
  reference_id?: unknown;
  products?: unknown;
}): NfeCfopKind {
  if (item.technical_sheets || item.reference_id) return 'industrial';
  return 'revenda';
}

export function resolveNfeCfop(args: {
  isInterstate: boolean;
  kind: NfeCfopKind;
  fiscal: NfeCfopFiscal;
}): { cfop: string; kind: NfeCfopKind } {
  const { isInterstate, kind, fiscal } = args;
  const industrialIn = pickCfop(fiscal.cfop_industrial_interno, pickCfop(fiscal.cfop, '5101'));
  const industrialOut = pickCfop(
    fiscal.cfop_industrial_externo,
    flipUf(industrialIn, true),
  );
  const resaleIn = pickCfop(fiscal.cfop_revenda_interno, '5102');
  const resaleOut = pickCfop(
    fiscal.cfop_revenda_externo,
    flipUf(resaleIn, true),
  );

  const chosen = kind === 'industrial'
    ? (isInterstate ? industrialOut : industrialIn)
    : (isInterstate ? resaleOut : resaleIn);
  const cfop = flipUf(chosen, isInterstate);
  if (!CFOP_RE.test(cfop)) {
    throw new Error(`CFOP inválido após resolução: "${cfop}".`);
  }
  return { cfop, kind };
}

/** Cabeçalho: se houver item de indústria, a nota é de produção própria. */
export function resolveHeaderNfeCfop(
  items: Array<{ cfop: string; kind: NfeCfopKind }>,
): { cfop: string; kind: NfeCfopKind } {
  if (items.length === 0) return { cfop: '5101', kind: 'industrial' };
  return items.find((item) => item.kind === 'industrial') ?? items[0];
}

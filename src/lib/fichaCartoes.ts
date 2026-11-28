/**
 * Plano dos cartões do montador — espelha `plan_ficha_cartoes` / `resolve_ficha`
 * no banco e `resolveFicha` em worksheet/fichaSize.ts.
 *
 * 1 cartão por ficha cheia (12/15/18) + 1 cartão da sobra quando o total
 * não fecha o corrugado. O código único (PM-000001) só nasce no banco;
 * esta lib só calcula a quebra da OP.
 */
import { resolveFicha } from '@/components/production/worksheet/fichaSize';
import { chunkPages } from '@/lib/cartaoFisico';

export const FICHA_CARTAO_SETOR_PALMILHA = 'palmilha';
export const FICHA_CARTAO_CODIGO_PREFIX = 'PM-';
/** Cartão do Montador permanece 15/folha (3×5); o Fardo passou a 18 (3×6). */
export const CARTAO_MONTADOR_PER_PAGE = 15;

export interface FichaCartaoPlanItem {
  ficha_index: number;
  total_fichas: number;
  ficha_size: number;
  pares: number;
  is_sobra: boolean;
  grade: Record<string, number>;
}

export interface FichaCartaoRow {
  id: string;
  codigo: string;
  order_id: string;
  op_number: string | null;
  sales_order_number: string | null;
  ficha_index: number;
  total_fichas: number;
  ficha_size: number;
  pares: number;
  is_sobra: boolean;
  grade_json?: Record<string, number> | null;
  setor: string;
  status: 'emitido' | 'baixado' | 'cancelado';
  montador_id?: string | null;
  baixado_em?: string | null;
}

export function planFichaCartoes(
  totalPairs: number,
  grid: Record<string, number> | null | undefined,
): FichaCartaoPlanItem[] {
  const total = Number(totalPairs) || 0;
  if (total <= 0) return [];
  const resolved = resolveFicha(total, grid);
  const full = Math.floor(total / resolved.corrugado);
  const rem = total % resolved.corrugado;
  const totalFichas = full + (rem > 0 ? 1 : 0);
  if (totalFichas <= 0) return [];
  const grade = resolved.baseCurve ? { ...resolved.baseCurve } : {};
  const items: FichaCartaoPlanItem[] = [];
  for (let i = 1; i <= full; i += 1) {
    items.push({
      ficha_index: i,
      total_fichas: totalFichas,
      ficha_size: resolved.corrugado,
      pares: resolved.corrugado,
      is_sobra: false,
      grade,
    });
  }
  if (rem > 0) {
    items.push({
      ficha_index: totalFichas,
      total_fichas: totalFichas,
      ficha_size: resolved.corrugado,
      pares: rem,
      is_sobra: true,
      grade: {},
    });
  }
  return items;
}

/** Contador impresso no cartão: 01/75 (largura mínima 2). */
export function formatFichaCounter(index: number, total: number): string {
  const width = Math.max(2, String(Math.max(0, total)).length);
  return `${String(index).padStart(width, '0')}/${String(total).padStart(width, '0')}`;
}

export function isFichaCartaoCodigo(value: string): boolean {
  return /^PM-\d{6,}$/.test(String(value || '').trim());
}

export function chunkCartaoMontadorPages<T>(items: readonly T[]): T[][] {
  return chunkPages(items, CARTAO_MONTADOR_PER_PAGE);
}

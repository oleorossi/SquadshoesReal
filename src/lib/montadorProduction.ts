// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '@/integrations/supabase/client';
// FONTE ÚNICA do cálculo de produção por par (piece-rate) usado na FOLHA.
//
// Funcionário com payment_type='producao' é pago por par montado, valorado por
// dificuldade (médio/difícil). A produção diária vem da Ficha de Montadores
// (tabela ficha_montadores, modelo origem='chamada': 1 linha por dia/montador,
// pares por tamanho × dificuldade no jsonb `detalhe`). O R$/par é o SNAPSHOT
// gravado na própria linha (valor_par_medio/_dificil) no momento do apontamento
// — congelado, então reajuste do cadastro não reescreve folha passada.
//
// Espelha EXATAMENTE a fórmula de pagamento da tela Ficha de Montadores
// (FichaMontadoresPage.tsx, aba Produtividade: pago = paresMedio×valorMedio +
// paresDificil×valorDificil). Só linhas 'chamada' entram — o legado por-grade
// (origem='legacy') fica de fora pra não contar produção duas vezes.
// ─────────────────────────────────────────────────────────────────────────────

/** Linha de ficha_montadores relevante pra folha por par. */
export interface FichaMontadorRow {
  montador_id: string | null;
  dia?: string | null;
  total?: number | null;
  detalhe?: { tamanho?: number; pares?: number; medio?: number; dificil?: number }[] | null;
  origem?: string | null;
  numeracoes?: string[] | null;
  valor_par?: number | null;         // LEGADO = taxa base (== médio)
  valor_par_medio?: number | null;
  valor_par_dificil?: number | null;
}

export interface ProducaoAgg {
  paresMedio: number;
  paresDificil: number;
  pares: number;
  /** R$ bruto = Σ (paresMedio×valor_par_medio + paresDificil×valor_par_dificil) por linha. */
  bruto: number;
}

/** Produção diária (modelo novo) — mesma heurística de isChamada da Ficha de Montadores. */
export function isChamadaRow(f: FichaMontadorRow): boolean {
  return f.origem === 'chamada'
    || (f.origem == null && Array.isArray(f.numeracoes) && f.numeracoes.length === 0);
}

/** Pares por dificuldade de UMA linha (espelha diffSizeMapOf/paresDiffOf da Ficha). */
export function paresDiffOfRow(f: FichaMontadorRow): { medio: number; dificil: number } {
  let medio = 0, dificil = 0;
  if (Array.isArray(f.detalhe) && f.detalhe.length) {
    for (const d of f.detalhe) {
      const t = Number(d?.tamanho);
      if (!t) continue;
      if (d.medio != null || d.dificil != null) {
        medio += Number(d.medio) || 0;
        dificil += Number(d.dificil) || 0;
      } else {
        // legado {tamanho, pares} = tudo médio
        medio += Number(d.pares) || 0;
      }
    }
    return { medio, dificil };
  }
  // sem detalhe: total como pares em MÉDIO (mesmo fallback da Ficha).
  const tot = Number(f.total) || 0;
  return { medio: tot > 0 ? tot : 0, dificil: 0 };
}

/** R$/par por dificuldade dessa linha (snapshot). Médio cai no legado valor_par. */
export function ratesOfRow(f: FichaMontadorRow): { vm: number; vd: number } {
  return {
    vm: Number(f.valor_par_medio ?? f.valor_par) || 0,
    vd: Number(f.valor_par_dificil) || 0,
  };
}

/** Soma a produção de uma LISTA de linhas já filtradas (um montador / um período). */
export function sumProducaoRows(rows: FichaMontadorRow[]): ProducaoAgg {
  const agg: ProducaoAgg = { paresMedio: 0, paresDificil: 0, pares: 0, bruto: 0 };
  for (const f of rows) {
    if (!isChamadaRow(f)) continue;
    const { medio, dificil } = paresDiffOfRow(f);
    const { vm, vd } = ratesOfRow(f);
    agg.paresMedio += medio;
    agg.paresDificil += dificil;
    agg.pares += medio + dificil;
    agg.bruto += medio * vm + dificil * vd;
  }
  return agg;
}

/** Agrega a produção por montador_id (bulk — usado pela folha e pelo KPI do mês). */
export function aggregateProducaoByMontador(rows: FichaMontadorRow[]): Map<string, ProducaoAgg> {
  const byMont = new Map<string, FichaMontadorRow[]>();
  for (const f of rows) {
    if (!f.montador_id || !isChamadaRow(f)) continue;
    const list = byMont.get(f.montador_id) || [];
    list.push(f);
    byMont.set(f.montador_id, list);
  }
  const out = new Map<string, ProducaoAgg>();
  for (const [id, list] of byMont) out.set(id, sumProducaoRows(list));
  return out;
}

/** Colunas de ficha_montadores necessárias pro cálculo (usar no .select()). */
export const FICHA_MONTADORES_PRODUCAO_COLUMNS =
  'montador_id, dia, total, detalhe, origem, numeracoes, valor_par, valor_par_medio, valor_par_dificil';

/** Busca toda a produção do intervalo; PostgREST limita cada página a 1.000 linhas. */
export async function fetchMontadorProducaoInRange(from: string, to: string): Promise<FichaMontadorRow[]> {
  const pageSize = 1000;
  const rows: FichaMontadorRow[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await (supabase as any)
      .from('ficha_montadores')
      .select(FICHA_MONTADORES_PRODUCAO_COLUMNS)
      .gte('dia', from)
      .lte('dia', to)
      .order('id')
      .range(start, start + pageSize - 1);
    if (error) throw error;
    const page = (data || []) as FichaMontadorRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

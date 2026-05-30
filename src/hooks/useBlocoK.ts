import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * SPED Bloco K (Livro de Controle da Produção e do Estoque) — paridade Tutor32.
 *
 * A RPC generate_bloco_k monta os registros a partir dos dados internos (OPs
 * finalizadas, débitos de estoque por OP, saldo de estoque). Aqui montamos o TXT
 * EFD (pipe-delimited) e registramos a geração em sped_exports. Não transmite —
 * a contabilidade valida no PVA da Receita.
 */

export interface BlocoKInsumo { cod_item: string; descr: string; qtd: number; dt_saida: string; }
export interface BlocoKK230 { cod_doc_op: string; cod_item: string; descr: string; dt_ini: string; dt_fin: string; qtd: number; insumos: BlocoKInsumo[]; }
export interface BlocoKK200 { dt_est: string; cod_item: string; descr: string; qtd: number; ind_est: string; }
export interface BlocoKResult { period_start: string; period_end: string; k230: BlocoKK230[]; k200: BlocoKK200[]; }

/** 'YYYY-MM-DD' → 'DDMMAAAA' (formato de data do EFD). */
function efdDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}${m}${y}`;
}

/** Número → string com vírgula decimal (separador do EFD). */
function efdNum(n: number): string {
  return (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3, useGrouping: false });
}

/** Monta o conteúdo TXT dos registros do Bloco K (K100/K230/K235/K200). */
export function buildBlocoKTxt(r: BlocoKResult): { txt: string; records: number } {
  const lines: string[] = [];
  // K100 — período de apuração
  lines.push(`|K100|${efdDate(r.period_start)}|${efdDate(r.period_end)}|`);
  // K230 produção + K235 insumos aninhados
  for (const k of r.k230) {
    lines.push(`|K230|${efdDate(k.dt_ini)}|${efdDate(k.dt_fin)}|${k.cod_doc_op}|${k.cod_item}|${efdNum(k.qtd)}|`);
    for (const i of k.insumos) {
      // |K235|DT_SAIDA|COD_ITEM|QTD|COD_INS_SUBST| (COD_INS_SUBST vazio)
      lines.push(`|K235|${efdDate(i.dt_saida)}|${i.cod_item}|${efdNum(i.qtd)}||`);
    }
  }
  // K200 estoque escriturado (COD_PART vazio para IND_EST=0)
  for (const s of r.k200) {
    lines.push(`|K200|${efdDate(s.dt_est)}|${s.cod_item}|${efdNum(s.qtd)}|${s.ind_est}||`);
  }
  return { txt: lines.join('\r\n') + '\r\n', records: lines.length };
}

export function useGenerateBlocoK() {
  return useMutation({
    mutationFn: async ({ start, end }: { start: string; end: string }): Promise<BlocoKResult> => {
      const { data, error } = await supabase.rpc('generate_bloco_k' as any, { p_period_start: start, p_period_end: end });
      if (error) throw error;
      return data as unknown as BlocoKResult;
    },
    onError: (err: Error) => toast.error(`Erro ao gerar Bloco K: ${err.message}`),
  });
}

export interface SpedExport {
  id: string; sped_type: string; period_start: string; period_end: string;
  filename: string; generated_at: string; total_records: number; status: string; notes: string | null;
}

export function useSpedExports(spedType?: string) {
  return useQuery({
    queryKey: ['sped_exports', spedType ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('sped_exports' as any).select('*').order('generated_at', { ascending: false }).limit(50);
      if (spedType) q = q.eq('sped_type', spedType);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as SpedExport[];
    },
  });
}

export function useRegisterSpedExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { sped_type: string; period_start: string; period_end: string; filename: string; total_records: number; notes?: string }) => {
      const { error } = await supabase.from('sped_exports' as any).insert({
        sped_type: p.sped_type,
        period_start: p.period_start,
        period_end: p.period_end,
        filename: p.filename,
        total_records: p.total_records,
        status: 'gerado',
        notes: p.notes ?? '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sped_exports'] }); toast.success('Geração registrada no histórico SPED.'); },
    onError: (err: Error) => toast.error(`Erro ao registrar: ${err.message}`),
  });
}

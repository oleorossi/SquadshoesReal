// useSectorRoster — quem é de qual setor, pela fonte ÚNICA do banco.
//
// Antes a Ficha de Montadores tinha uma lista de setores hard-coded com uma
// REGEX por setor (/montagem|montador/i…) casada contra `role + department`.
// Levantamento em produção: 11 de 20 funcionários ativos não casavam com padrão
// nenhum e ficavam invisíveis na tela — sem aviso, sem jeito de lançar produção
// deles. E a taxonomia divergia do resto do sistema (a tela tinha 'costura'; o
// fluxo real tem Costura Palmilha e Costura Cabedal separadas).
//
// Agora setor e roster vêm de duas views canônicas:
//   v_production_sectors — os setores oficiais (sector_settings) já com a chave
//                          normalizada por capacity_sector_key, em flow_order.
//   v_employee_sector    — vínculo funcionário↔setor (department + allocation).
//
// Consequência que importa: o roster desta tela e o headcount que o PCP usa
// passam a sair da MESMA regra. Não dá mais pra alguém estar no setor pra um e
// fora pro outro.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ProductionSector {
  /** Chave canônica (capacity_sector_key). ATENÇÃO: Aviamento = 'mesa'. */
  key: string;
  label: string;
  flowOrder: number;
  /** Override manual de equipe em sector_settings (null = deriva do RH). */
  headcount: number | null;
  /** Setor pago por PAR produzido em vez de salário + hora extra. */
  paysByPair: boolean;
  /** Setor separa os pares em médio/difícil (R$/par diferente por dificuldade).
   *  false = taxa única — hoje a Solagem. Só faz sentido com paysByPair. */
  paysByDifficulty: boolean;
}

export interface EmployeeSector {
  employee_id: string;
  name: string;
  role: string | null;
  department: string | null;
  external_id: string | null;
  active: boolean;
  payment_type: string | null;
  valor_par_medio: number | null;
  valor_par_dificil: number | null;
  sector_key: string;
  sector_label: string;
  allocation_fraction: number;
  /** 'allocation' = vínculo explícito (vence); 'department' = pelo cadastro. */
  origem: 'department' | 'allocation';
  /** false para lotação não-produtiva (Administrativo, Comercial…). */
  setor_produtivo: boolean;
}

/** Linha crua da v_production_sectors (view nova — ainda não está em types.ts). */
interface RawProductionSector {
  sector_key: string;
  sector_label: string;
  flow_order: number | string;
  headcount: number | string | null;
  pays_by_pair: boolean | null;
  pays_by_difficulty: boolean | null;
}

/** As views novas não estão nos tipos gerados; `from` é destipado só no acesso. */
const fromView = (view: string) => (supabase as unknown as {
  from: (v: string) => {
    select: (cols: string) => {
      order: (col: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      eq: (col: string, val: unknown) => {
        order: (col: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}).from(view);

/** Setores de produção, na ordem do fluxo de fábrica.
 *
 *  ⚠ A queryKey é ['production-sectors', 'detail'] e NÃO ['production-sectors']:
 *  `SectorSelectField` (cadastro de Funcionários) já ocupa a chave curta
 *  devolvendo `string[]` (só os nomes). Duas queries com a mesma chave e
 *  formatos diferentes se sobrescrevem no cache global — quem carregasse
 *  primeiro entregaria o formato errado pra outra tela, e o caminho
 *  Funcionários → Ficha de Montadores dispara isso.
 *
 *  O segmento extra preserva a invalidação: `invalidateQueries` com a chave
 *  curta casa por PREFIXO, então criar um setor novo no cadastro continua
 *  atualizando as abas desta tela. */
export function useProductionSectors() {
  return useQuery({
    queryKey: ['production-sectors', 'detail'],
    queryFn: async (): Promise<ProductionSector[]> => {
      const { data, error } = await fromView('v_production_sectors')
        .select('sector_key, sector_label, flow_order, headcount, pays_by_pair, pays_by_difficulty')
        .order('flow_order');
      if (error) throw error;
      return ((data ?? []) as RawProductionSector[]).map((r) => ({
        key: r.sector_key,
        label: r.sector_label,
        flowOrder: Number(r.flow_order) || 0,
        headcount: r.headcount == null ? null : Number(r.headcount),
        paysByPair: r.pays_by_pair === true,
        // DEFAULT true no banco: a ausência de dificuldade é a exceção declarada
        // (Solagem). `!== false` mantém isso mesmo se a coluna vier nula.
        paysByDifficulty: r.pays_by_difficulty !== false,
      }));
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}

/** Vínculo funcionário↔setor dos ATIVOS (uma linha por par funcionário/setor). */
export function useEmployeeSectors() {
  return useQuery({
    queryKey: ['employee-sectors'],
    queryFn: async (): Promise<EmployeeSector[]> => {
      const { data, error } = await fromView('v_employee_sector')
        .select('*')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as EmployeeSector[];
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

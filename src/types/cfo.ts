/** Planejamento gerencial: não cria títulos nem movimenta estoque ou bancos. */
export interface CfoPlan {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  saldo_inicial: number;
  reserva_minima: number;
  created_at?: string;
  updated_at?: string;
}

export interface CfoOrder {
  id: string;
  plano_id: string;
  pedido_venda_id: string | null;
  descricao: string;
  entrega_em: string;
  lucro_informado: number;
  /** true = materiais já descontados do lucro; false = deduzir materiais vinculados. */
  lucro_liquido: boolean;
  receita_total: number | null;
  status: 'ativo' | 'cancelado';
  created_at?: string;
  updated_at?: string;
}

export type CfoEntryType = 'recebimento' | 'material' | 'despesa' | 'aporte' | 'retirada';
export interface CfoEntry {
  id: string;
  plano_id: string;
  pedido_id: string | null;
  tipo: CfoEntryType;
  descricao: string;
  data_prevista: string;
  valor_previsto: number;
  data_realizada: string | null;
  valor_realizado: number | null;
  status: 'previsto' | 'realizado' | 'cancelado';
  created_at?: string;
  updated_at?: string;
}

export type CfoPlanInput = Omit<CfoPlan, 'id' | 'created_at' | 'updated_at'> & { id?: string };
export type CfoOrderInput = Omit<CfoOrder, 'id' | 'created_at' | 'updated_at'> & { id?: string };
export type CfoEntryInput = Omit<CfoEntry, 'id' | 'created_at' | 'updated_at'> & { id?: string };

/** Totais informados pelo usuário para a semana (segunda a domingo). */
export interface CfoWeekInput {
  id: string;
  plano_id: string;
  semana_inicio: string;
  contas_semana: number;
  reinvestimento: number;
  /** NULL = produção ainda não informada; zero = semana sem produção. */
  pares_produzidos: number | null;
  created_at?: string;
  updated_at?: string;
}

export type CfoWeekSaveInput = Omit<CfoWeekInput, 'id' | 'created_at' | 'updated_at'> & { id?: string };

// Transport module types

export interface Bau {
  id: string;
  nome: string;
  comprimento_cm: number;
  largura_cm: number;
  altura_cm: number;
  capacidade_kg?: number | null;
  notas?: string | null;
  active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BoxType {
  id: string;
  nome: string;
  comprimento_cm: number;
  largura_cm: number;
  altura_cm: number;
  interno?: boolean | null;
  empilhamento_maximo?: number | null;
  peso_kg?: number | null;
  active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ItemType {
  id: string;
  nome: string;
  comprimento_cm?: number | null;
  largura_cm?: number | null;
  altura_cm?: number | null;
  volume_cm3?: number | null;
  peso_kg?: number | null;
  active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TransportCompany {
  id: string;
  nome: string;
  tipo_pessoa: 'FISICA' | 'JURIDICA';
  documento?: string | null;
  telefone?: string | null;
  email?: string | null;
  endereco?: {
    rua?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    cep?: string;
  } | null;
  responsavel?: string | null;
  condicoes_pagamento?: string | null;
  seguro?: boolean | null;
  servicos?: string[] | null;
  sla_dias?: number | null;
  observacoes?: string | null;
  active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TransportCompanyRate {
  id: string;
  transport_company_id: string;
  estado: string;
  valor_capital: number;
  valor_interior: number;
  tipo_valor: 'POR_KG' | 'POR_M3' | 'FIXO';
  minimo?: number | null;
  moeda?: string | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PackingItem {
  id: string;
  type: 'box' | 'item';
  nome: string;
  L: number;
  W: number;
  H: number;
  maxStack?: number | null;
  quantity?: number;
}

export interface PackingResult {
  id: string;
  type: 'box' | 'item';
  nome: string;
  orientation: [number, number, number];
  nL: number;
  nW: number;
  nH: number;
  /** Mantido para compatibilidade; representa a quantidade solicitada. */
  total: number;
  quantidade_solicitada: number;
  capacidade_por_viagem: number;
  viagens_necessarias: number;
  volume_m3: number;
  ocupacao_pct: number;
  fits: boolean;
  warning?: string;
}

export interface PackingSummary {
  bau_volume_m3: number;
  total_volume_m3: number;
  ocupacao_total_pct: number;
  residual_volume_m3: number;
  results: PackingResult[];
}

export const BRAZILIAN_STATES = [
  { uf: 'AC', name: 'Acre' },
  { uf: 'AL', name: 'Alagoas' },
  { uf: 'AP', name: 'Amapá' },
  { uf: 'AM', name: 'Amazonas' },
  { uf: 'BA', name: 'Bahia' },
  { uf: 'CE', name: 'Ceará' },
  { uf: 'DF', name: 'Distrito Federal' },
  { uf: 'ES', name: 'Espírito Santo' },
  { uf: 'GO', name: 'Goiás' },
  { uf: 'MA', name: 'Maranhão' },
  { uf: 'MT', name: 'Mato Grosso' },
  { uf: 'MS', name: 'Mato Grosso do Sul' },
  { uf: 'MG', name: 'Minas Gerais' },
  { uf: 'PA', name: 'Pará' },
  { uf: 'PB', name: 'Paraíba' },
  { uf: 'PR', name: 'Paraná' },
  { uf: 'PE', name: 'Pernambuco' },
  { uf: 'PI', name: 'Piauí' },
  { uf: 'RJ', name: 'Rio de Janeiro' },
  { uf: 'RN', name: 'Rio Grande do Norte' },
  { uf: 'RS', name: 'Rio Grande do Sul' },
  { uf: 'RO', name: 'Rondônia' },
  { uf: 'RR', name: 'Roraima' },
  { uf: 'SC', name: 'Santa Catarina' },
  { uf: 'SP', name: 'São Paulo' },
  { uf: 'SE', name: 'Sergipe' },
  { uf: 'TO', name: 'Tocantins' },
] as const;

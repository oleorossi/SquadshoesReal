/**
 * Catálogo de MENUS individuais que admin pode liberar/bloquear pra um
 * usuário no dialog "Criar Usuário". Cada entrada é um par module → label
 * em PT-BR + grupo onde aparece na sidebar.
 *
 * Os módulos espelham ROUTE_MODULE_MAP em useAccessControl.ts. Se mudar
 * lá, mudar aqui.
 */

export interface MenuOption {
  module: string;
  label: string;
  description: string;
  /** Grupo da sidebar pra organizar os checkboxes visualmente. */
  group: 'Comercial' | 'Produção' | 'Engenharia' | 'Estoque' | 'Compras' | 'Logística' | 'Financeiro' | 'RH' | 'Sistema';
  /** True quando este módulo só pode ser acessado por admin (não dá pra liberar
   *  individualmente). Mantemos na lista pra transparência mas com checkbox
   *  desabilitado + tooltip explicativo. */
  adminOnly?: boolean;
  /** True quando é módulo "core" que basicamente todo usuário deveria ter. */
  alwaysOn?: boolean;
}

export const MENU_OPTIONS: MenuOption[] = [
  // SEMPRE LIBERADO — dashboard é a tela inicial
  { module: 'dashboard', label: 'Painel (dashboard)', description: 'Tela inicial com indicadores gerais', group: 'Comercial', alwaysOn: true },

  // COMERCIAL
  { module: 'vendas', label: 'Pedidos de Venda', description: 'Criar/editar PVs, Pronta-Entrega, CRM, SAC, Forecast, Tabelas de Preço', group: 'Comercial' },
  { module: 'clientes', label: 'Clientes', description: 'Cadastro de lojistas e grupos econômicos', group: 'Comercial' },

  // PRODUÇÃO
  { module: 'producao', label: 'Produção (PCP)', description: 'PCP, capacidade, gargalos, imprimir fichas, centro de controle, timeline', group: 'Produção' },
  { module: 'ordens', label: 'Ordens (OPs)', description: 'Listar e editar OPs, picking, shop-floor, auditoria de fluxo', group: 'Produção' },

  // ENGENHARIA
  { module: 'produtos', label: 'Fichas Técnicas', description: 'Fichas técnicas, solados, silks, receitas artesanais, imagens', group: 'Engenharia' },

  // ESTOQUE
  { module: 'estoque', label: 'Estoque', description: 'Estoque, MRP, ajustes, histórico, alertas, reservas, custos de insumos', group: 'Estoque' },

  // COMPRAS
  { module: 'fornecedores', label: 'Fornecedores e Compras', description: 'Cadastro de fornecedores, ordens de compra, cotações (RFQ), planejamento', group: 'Compras' },

  // LOGÍSTICA
  { module: 'expedicao', label: 'Expedição e Logística', description: 'Expedição, conferência, romaneios, entregas, transportadoras, etiquetas, embalagens', group: 'Logística' },

  // FINANCEIRO
  { module: 'financeiro', label: 'Financeiro', description: 'Contas (AR/AP), conciliação, SPED, markup, CT-e, MDF-e, CNAB, OCs', group: 'Financeiro' },
  { module: 'nfe', label: 'NF-e', description: 'Emissão e consulta de Notas Fiscais Eletrônicas', group: 'Financeiro' },
  { module: 'empresas_fiscal', label: 'Empresas Fiscais', description: 'Cadastro das empresas emissoras de NF-e', group: 'Financeiro' },
  { module: 'rh_folha', label: 'Folha de Pagamento', description: 'Cálculo de folha (gera financial_entries — restrito).', group: 'Financeiro' },

  // RH
  { module: 'rh', label: 'RH (Funcionários e Ponto)', description: 'Cadastro de funcionários, controle de ponto, banco de horas, escalas, faltas', group: 'RH' },
  { module: 'terceirizados', label: 'Terceirizados', description: 'Cadastro de prestadores PJ e ordens de serviço', group: 'RH' },

  // RELATÓRIOS / SISTEMA
  { module: 'reports', label: 'Relatórios Operacionais', description: 'Relatórios de OP, OEE, qualidade, refugo, diário de produção', group: 'Sistema' },
  { module: 'sistema', label: 'Configurações e Administração', description: 'Configurações, automações, segurança, auditoria, LGPD, monitoramento, diagnóstico — APENAS para administradores', group: 'Sistema', adminOnly: true },
];

/** Lista de módulos válidos pra validação no backend. */
export const VALID_MODULES = MENU_OPTIONS.map(m => m.module);

/** Agrupa opções pelo grupo da sidebar — pra renderizar em seções no dialog. */
export function getMenuOptionsGrouped(): Record<MenuOption['group'], MenuOption[]> {
  const out: Record<string, MenuOption[]> = {};
  for (const opt of MENU_OPTIONS) {
    if (!out[opt.group]) out[opt.group] = [];
    out[opt.group].push(opt);
  }
  return out as Record<MenuOption['group'], MenuOption[]>;
}

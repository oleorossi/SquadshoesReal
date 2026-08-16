import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/**
 * Só o CÓDIGO — tira comentários de bloco e de linha. Sem isso o contrato
 * dispara nos próprios comentários que explicam a depreciação, e o jeito de
 * "consertar" seria apagar a explicação: exatamente o contrário do que se quer.
 */
const codeOf = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trimStart().startsWith('//'))
    .join('\n');

/**
 * Consolidação 02/08/2026 — embalagem tem UMA fonte: o MODELO DE SOLADO
 * (`product_groups.box_type_*_id` + `pairs_per_box_*`), editado somente em
 * Embalagens → Configuração por Solado.
 *
 * ANTES existiam três donos:
 *   1. `product_groups.*`          — editado em Estoque → Grupos (aba Embalagem)
 *   2. `technical_sheet_box_types` — editado em Fichas Técnicas (aba Embalagem)
 *   3. `box_types`                 — Gestão de Embalagens
 * e o débito dava PRECEDÊNCIA ao caminho 2, então configurar pelo solado seria
 * silenciosamente ignorado por qualquer ficha com vínculo antigo.
 *
 * Pior: `technical_sheet_box_types` é N:N sem restrição de tipo — as fichas i40
 * e SP130 tinham DUAS caixas 'individual' cada, e o FOR..LOOP da RPC debitaria
 * as duas pelos mesmos pares. Nunca estourou porque a função nunca rodou (zero
 * movimentos 'Débito embalagem%' em toda a história do banco até 02/08/2026).
 *
 * Este contrato existe porque a guarda é de UI e de prosa em SQL — frágil por
 * natureza. O erro tem que aparecer no CI, não em produção.
 */

/** As três funções SQL que liam o caminho da ficha e tinham que trocar juntas. */
const FUNCOES_MIGRADAS = [
  'debit_packaging_for_order',        // baixa de estoque
  'compute_sale_order_box_breakdown', // volumes e peso bruto da NF-e
  'fn_projected_packaging_demand',    // demanda projetada do MRP
];

const MIGRATION = 'supabase/migrations/20261110120000_packaging-single-source-sole-group.sql';
const INTEGRITY_MIGRATION = 'supabase/migrations/20270101002100_integridade_setor_embalagem.sql';

describe('embalagem tem uma fonte só: o modelo de solado', () => {
  it('nenhuma tela viva lê technical_sheet_box_types', () => {
    // A tabela continua existindo (histórico), mas ninguém pode voltar a ler
    // dela — é o que reintroduz a precedência invertida e o débito em dobro.
    // PackagingLinksPanel saiu da lista porque foi APAGADO em 02/08/2026 (R5 do
    // sistema de telas): só espelhava o que Solados edita, então a tela exibia o
    // mesmo dado duas vezes e nenhuma das duas era a fonte.
    const telas = [
      'src/components/technical-sheets/PackagingTab.tsx',
      'src/components/packaging/PackagingDecision.tsx',
      'src/components/packaging/PackagingStockPanel.tsx',
      'src/components/soles-hub/SolePackagingPanel.tsx',
    ];
    const culpadas = telas.filter(rel => codeOf(rel).includes('technical_sheet_box_types'));
    expect(
      culpadas,
      `voltaram a ler technical_sheet_box_types: ${culpadas.join(', ')}. ` +
      'A fonte é product_groups (modelo de solado) — ver migration 20261110120000.',
    ).toEqual([]);
  });

  it('as três funções SQL leem o solado e não a ficha', () => {
    const mig = read(MIGRATION);
    for (const fn of FUNCOES_MIGRADAS) {
      expect(mig, `a migration não redefine ${fn}`).toContain(`FUNCTION public.${fn}`);
    }
    // Nenhum CREATE FUNCTION pode voltar a consultar a tabela aposentada. Ela só
    // pode aparecer no COMMENT de depreciação e nos comentários explicativos.
    const corpoSql = mig
      .split('\n')
      .filter(l => !l.trimStart().startsWith('--'))
      .join('\n');
    const leituras = corpoSql.match(/(FROM|JOIN)\s+public\.technical_sheet_box_types/gi) ?? [];
    expect(leituras, 'alguma função voltou a consultar technical_sheet_box_types').toEqual([]);
  });

  it('a edição da embalagem saiu de Estoque → Grupos', () => {
    // Dois editores das MESMAS colunas fazem o diálogo de grupo regravar valor
    // velho por cima do que foi configurado em Solados (ele hidratava no mount).
    const src = read('src/components/groups/GroupEditDialog.tsx');
    for (const col of ['box_type_master_id', 'box_type_colmeia_id', 'box_type_fitilho_id', 'pairs_per_box_individual']) {
      expect(src, `GroupEditDialog voltou a gravar ${col}`).not.toContain(col);
    }
    // Criação de grupo também não pode semear caixa: solado nasce VAZIO, com
    // pendência visível (decisão do dono — nada herdado em silêncio).
    const create = read('src/components/groups/GroupCreateDialog.tsx');
    expect(create).not.toMatch(/box_type_master_id:\s*form\./);
  });

  it('o editor central por tipo de solado cobre os TRÊS modos', () => {
    // O modo é escolhido no PV (sale_orders.packaging_mode). Se o solado não
    // tiver os três montados, o PV entra e não debita nada.
    const src = read('src/components/soles-hub/SolePackagingPanel.tsx');
    for (const slot of ['individual', 'master', 'colmeia', 'fitilho']) {
      expect(src, `o painel do solado não cobre o slot ${slot}`).toContain(slot);
    }
    for (const modo of ['Tradicional', 'Amarrado', 'Colméia']) {
      expect(src, `o painel do solado não monta o modo ${modo}`).toContain(modo);
    }
  });

  it('a edição por solado existe somente dentro de /embalagens', () => {
    const management = codeOf('src/pages/PackagingManagement/index.tsx');
    const central = codeOf('src/components/packaging/SolePackagingConfigurationPanel.tsx');
    const soles = codeOf('src/components/soles-hub/SolesConsumosTab.tsx');
    const transport = codeOf('src/pages/Transport.tsx');

    expect(management).toContain('SolePackagingConfigurationPanel');
    expect(central).toContain('SolePackagingPanel');
    expect(soles, 'Solados voltou a montar o editor de embalagem').not.toContain('SolePackagingPanel');
    expect(transport, 'Transporte voltou a embutir o módulo editável').not.toContain('PackagingManagementPage');
  });

  it('ficha, PV e OP não criam configuração paralela', () => {
    for (const rel of [
      'src/hooks/useTechnicalSheets.ts',
      'src/pages/TechnicalSheets.tsx',
      'src/components/sale-orders/SaleOrderFormPanel.tsx',
    ]) {
      expect(codeOf(rel), `${rel} voltou a acessar packaging_configs`).not.toMatch(/\.from\(['"]packaging_configs['"]\)/);
    }
    expect(codeOf('src/pages/Orders.tsx')).not.toMatch(/form\.packaging_(product_id|quantity|type)/);
    expect(codeOf('src/hooks/useOrders.ts')).not.toContain('debit_packaging_for_order_atomic');
  });

  it('o cadastro da caixa é um componente só, montado nos dois lugares', () => {
    // Os dois pontos ficam no MESMO módulo /embalagens: estoque e vínculo por
    // solado compartilham o formulário de caixa.
    for (const rel of [
      'src/components/packaging/PackagingStockPanel.tsx',
      'src/components/soles-hub/SolePackagingPanel.tsx',
    ]) {
      expect(read(rel), `${rel} não usa o formulário compartilhado`).toContain('BoxTypeFormDialog');
    }
  });

  it('metros de fitilho vêm da caixa, não do solado', () => {
    const mig = read(MIGRATION);
    expect(mig).toContain('metros_per_amarrado_default');
    // A coluna do grupo nunca teve tela que a editasse — não pode voltar a ser lida.
    const corpoSql = mig
      .split('\n')
      .filter(l => !l.trimStart().startsWith('--'))
      .join('\n');
    const usos = corpoSql.match(/pg\.metros_fitilho_per_amarrado|v_pg\.metros_fitilho_per_amarrado/g) ?? [];
    expect(usos, 'alguma função voltou a ler product_groups.metros_fitilho_per_amarrado').toEqual([]);
  });

  it('o aviso de débito manda o operador pra tela certa', () => {
    const src = codeOf('src/lib/packagingDebitWarnings.ts');
    expect(src, 'o aviso ainda aponta pra Estoque → Grupos, que não edita mais').not.toMatch(/Estoque → Grupos/);
    expect(src).toContain('Embalagens');
    // Ficha sem solado e solado sem caixa se consertam em telas diferentes.
    expect(src).toContain('sheet_without_sole_group');
  });

  it('o débito novo é reconciliável, auditável e não baixa histórico', () => {
    const migration = read(INTEGRITY_MIGRATION);
    expect(migration).toContain('FUNCTION public.plan_packaging_for_order');
    expect(migration).toContain('FUNCTION public.list_packaging_debit_audit');
    expect(migration).toContain("WHEN 'in'  THEN -sm.quantity");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('trg_reconcile_packaging_on_order_insert');
    expect(migration).toContain('trg_reconcile_packaging_on_sole_group');
    expect(migration).toContain('upsert_box_type_with_stock');
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.debit_packaging_for_order_atomic');
    expect(migration, 'a migration não pode debitar OPs antigas em lote').not.toMatch(/UPDATE\s+public\.orders/i);
  });
});

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
 * (`product_groups.box_type_*_id` + `pairs_per_box_*`), editado em
 * Solados → Consumos → Embalagem.
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

describe('embalagem tem uma fonte só: o modelo de solado', () => {
  it('nenhuma tela viva lê technical_sheet_box_types', () => {
    // A tabela continua existindo (histórico), mas ninguém pode voltar a ler
    // dela — é o que reintroduz a precedência invertida e o débito em dobro.
    const telas = [
      'src/components/technical-sheets/PackagingTab.tsx',
      'src/components/packaging/PackagingDecision.tsx',
      'src/components/packaging/PackagingLinksPanel.tsx',
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

  it('a tela do solado edita os TRÊS modos', () => {
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

  it('o cadastro da caixa é um componente só, montado nos dois lugares', () => {
    // "Mesmo componente nos dois lugares" foi a decisão que evita o padrão de
    // dois editores. Se um deles reintroduzir um formulário próprio, divergem.
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
    expect(src).toContain('Solados');
    // Ficha sem solado e solado sem caixa se consertam em telas diferentes.
    expect(src).toContain('sheet_without_sole_group');
  });
});

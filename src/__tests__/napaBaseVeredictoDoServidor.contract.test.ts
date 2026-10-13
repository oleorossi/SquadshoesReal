import { describe, expect, it } from 'vitest';
import { strapLinesForStockPreview } from '@/lib/reconcileStrapSnapshots';
import { strapBaseAwaitsServer } from '@/lib/strapMaterialPolicy';
import { parseStrapStockLines } from '@/hooks/useStrapStockLines';
import { technicalStrapLineId } from '@/lib/technicalStrapLines';

/**
 * PV novo em SP301 / ROCHA (13/10/2026): a tela acusava
 * "A ficha não identifica o material-base desta posição. Revise o cadastro
 * técnico." com o cadastro COMPLETO — `technical_sheets.strap_base_group_id`
 * = NAPA SOFT e `resolve_strap_base_group_id` devolvendo NAPA SOFT.
 *
 * Eram duas falhas somadas:
 *  1. o painel montava a prévia de estoque a partir de `item.strap_colors`
 *     (snapshot ainda não reconciliado) e pulava o item inteiro; o batch
 *     devolve `[]`, não `undefined`, então a tela não ficava "carregando" —
 *     concluía ausência;
 *  2. a tela tratava "sem napa resolvida" como defeito de ficha, sendo que
 *     quem resolve napa em `follow_reference` é o SERVIDOR.
 */

const LINE_ID = 'd9b48d86-0ba6-4530-bb89-1b8967ef3f5e';
const sheetLine = {
  id: LINE_ID,
  technical_strap_line_id: LINE_ID,
  label: 'FRENTE',
  color: '',
  color_mode: 'follow_main',
  material_mode: 'follow_reference',
  identity_basis: 'reference_base',
  identity_group_id: null,
  material_group_id: null,
  allowed_material_group_ids: [],
  measure_id: '06500a23-801d-4627-a927-3ce7e5ee2619',
  strap_type_id: 'a69cb531-2d66-4931-9a71-8b06bec56eb0',
} as never;

describe('prévia de estoque das tiras: ficha ∪ snapshot', () => {
  it('item NOVO sem snapshot ainda entra na prévia com a linha da ficha', () => {
    const linhas = strapLinesForStockPreview([], [sheetLine], false);
    expect(linhas.map(technicalStrapLineId)).toEqual([LINE_ID]);
  });

  // `[]` precisa vir embrulhado: `it.each` espalha o array como argumentos.
  it.each([[null], [undefined], [[]]])(
    'strap_colors vazio (%s) não zera a prévia quando a ficha tem tira',
    (snapshot) => {
      expect(strapLinesForStockPreview(snapshot, [sheetLine], false).length).toBe(1);
    },
  );

  it('sem tira na ficha e sem snapshot não inventa linha', () => {
    expect(strapLinesForStockPreview([], [], false)).toEqual([]);
  });

  it('PV comprometido continua lendo só o snapshot congelado', () => {
    expect(strapLinesForStockPreview([], [sheetLine], true)).toEqual([]);
  });
});

describe('napa de follow_reference é veredito do SERVIDOR', () => {
  it('sem linha da prévia, "sem napa" é desconhecido — não acusa cadastro', () => {
    expect(strapBaseAwaitsServer(sheetLine, undefined)).toBe(true);
  });

  it('com a linha da prévia o veredito é do servidor, mesmo napa nula', () => {
    expect(strapBaseAwaitsServer(sheetLine, { baseGroupId: null })).toBe(false);
    expect(strapBaseAwaitsServer(sheetLine, { baseGroupId: 'a0c6dcee-c72f-4e66-8f69-47be847957d3' }))
      .toBe(false);
  });

  it('fixed_group e select_on_order guardam o grupo na ficha: acusam na hora', () => {
    expect(strapBaseAwaitsServer(
      { ...sheetLine as object, material_mode: 'fixed_group' } as never,
      undefined,
    )).toBe(false);
    expect(strapBaseAwaitsServer(
      { ...sheetLine as object, material_mode: 'select_on_order' } as never,
      undefined,
    )).toBe(false);
  });

  it('tira comprada pronta não depende da napa', () => {
    expect(strapBaseAwaitsServer(
      { ...sheetLine as object, identity_basis: 'finished_product_group' } as never,
      undefined,
    )).toBe(false);
  });
});

/**
 * Fecha o elo: a resposta REAL de `preview_sale_order_strap_demand_draft_batch`
 * para SP301 / ROCHA (capturada do banco em 13/10/2026, item sem snapshot) tem
 * que virar `baseGroupId` no cliente. Era este o valor que a tela nunca recebia
 * — não porque o servidor não soubesse, mas porque o item nem entrava no lote.
 */
const RESPOSTA_REAL_DO_SERVIDOR = [{
  line_ordinal: 1,
  technical_strap_line_id: LINE_ID,
  source_mode: null,
  gross_required_m: 108,
  blocking_reasons: [
    { code: 'color_id_missing', field: 'color_id', message: 'Cor sem UUID canonico persistido; texto/alias nao identifica estoque.' },
  ],
  resolved: {
    base_group_id: 'a0c6dcee-c72f-4e66-8f69-47be847957d3',
    base_group_name: 'NAPA SOFT',
    material_mode: 'follow_reference',
    identity_basis: 'reference_base',
    measure_name: '5 mm',
    base_product_name: null,
    catalog: {},
  },
}];

describe('resposta do servidor vira napa na tela', () => {
  it('SP301/ROCHA: a prévia real entrega NAPA SOFT ao cliente', () => {
    const [linha] = parseStrapStockLines(
      RESPOSTA_REAL_DO_SERVIDOR,
      [sheetLine as never],
    );
    expect(linha.baseGroupId).toBe('a0c6dcee-c72f-4e66-8f69-47be847957d3');
    expect(linha.baseGroupName).toBe('NAPA SOFT');
    expect(linha.key).toBe(LINE_ID);
    // Com a linha em mãos, a tela para de esperar e não acusa cadastro.
    expect(strapBaseAwaitsServer(sheetLine, linha)).toBe(false);
  });
});

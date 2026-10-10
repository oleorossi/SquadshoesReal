import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyDefaultStrapPvOrigemChoices,
  applyStrapPvOrigemChangesToItems,
  catalogDefaultStrapPvOrigem,
  coerceImpossibleBuyReadyStrapOrigem,
  collectStrapPvOrigemChanges,
  DEFAULT_STRAP_PV_ORIGEM,
  defaultStrapPvOrigemForLine,
  groupStrapHubIncompleteByMeasure,
  isStrapPvOrigemChoiceLocked,
  listStrapHubIncompleteForOrigem,
  resolveEffectiveStrapPvOrigem,
  sourceModeForEffectiveOrigem,
  STRAP_PV_ORIGEM_LABEL,
  strapFreightPerMeter,
  strapPvOrigemChooserValue,
  strapPvOrigemLabel,
} from '@/lib/strapPvOrigem';
import {
  HUB_ORIGEM_PADRAO_LABEL,
  hubOrigemPadraoChoice,
} from '@/lib/strapBaseNapaPeel';

describe('strapPvOrigem', () => {
  it('vocabulário: Prestador | Comprar pronto (R1) — prestador legado = Prestador', () => {
    expect(STRAP_PV_ORIGEM_LABEL).toEqual({ fabrica: 'Prestador', sku_acabado: 'Comprar pronto' });
    expect(strapPvOrigemLabel('fabrica')).toBe('Prestador');
    expect(strapPvOrigemLabel('prestador')).toBe('Prestador');
    expect(strapPvOrigemLabel('sku_acabado')).toBe('Comprar pronto');
    expect(strapPvOrigemLabel(null)).toBeNull();
    expect(Object.values(STRAP_PV_ORIGEM_LABEL).join(' ')).not.toMatch(/Fazer|Fábrica|interna/i);
  });

  it('catálogo dá o PADRÃO: só sempre_sku_acabado vira Comprar pronto', () => {
    expect(catalogDefaultStrapPvOrigem({ id: 'm', origem_padrao: 'sempre_sku_acabado' })).toBe('sku_acabado');
    expect(catalogDefaultStrapPvOrigem({ id: 'm', origem_padrao: 'sempre_fabrica' })).toBe('fabrica');
    expect(catalogDefaultStrapPvOrigem({ id: 'm', origem_padrao: 'escolhe_no_pv' })).toBe('fabrica');
    expect(catalogDefaultStrapPvOrigem({ id: 'm' })).toBe('fabrica');
    expect(DEFAULT_STRAP_PV_ORIGEM).toBe('fabrica');
  });

  it('Hub mostra só Prestador | Comprar pronto (escolhe_no_pv legado = Prestador)', () => {
    expect(hubOrigemPadraoChoice('escolhe_no_pv')).toBe('sempre_fabrica');
    expect(hubOrigemPadraoChoice('sempre_fabrica')).toBe('sempre_fabrica');
    expect(hubOrigemPadraoChoice(null)).toBe('sempre_fabrica');
    expect(hubOrigemPadraoChoice('sempre_sku_acabado')).toBe('sempre_sku_acabado');
    expect(HUB_ORIGEM_PADRAO_LABEL).toEqual({
      sempre_fabrica: 'Prestador',
      sempre_sku_acabado: 'Comprar pronto',
    });
  });

  it('escolha explícita do PV VENCE o catálogo em qualquer medida (R2)', () => {
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: 'fabrica' },
      { id: 'strass', origem_padrao: 'sempre_sku_acabado' },
    )).toBe('fabrica');
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: 'sku_acabado', group_id: 'g1' },
      { id: 'm1', origem_padrao: 'sempre_fabrica' },
    )).toBe('sku_acabado');
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: 'prestador' },
      { id: 'm1', origem_padrao: 'sempre_sku_acabado' },
    )).toBe('fabrica');
  });

  it('sem escolha vale o padrão do catálogo — a origem nunca falta', () => {
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: null },
      { id: 'm1', origem_padrao: 'escolhe_no_pv' },
    )).toBe('fabrica');
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: null, group_id: 'g-strass' },
      { id: 'strass', origem_padrao: 'sempre_sku_acabado' },
    )).toBe('sku_acabado');
    // Catálogo ainda não carregou: não inventa.
    expect(resolveEffectiveStrapPvOrigem({ pv_origem: null }, null)).toBeNull();
  });

  it('padrão Comprar pronto sem grupo acabado na ficha cai em Prestador (espelha 28600)', () => {
    expect(defaultStrapPvOrigemForLine(
      { group_id: null },
      { id: 'strass', origem_padrao: 'sempre_sku_acabado' },
    )).toBe('fabrica');
    expect(defaultStrapPvOrigemForLine(
      { identity_group_id: 'g1' },
      { id: 'strass', origem_padrao: 'sempre_sku_acabado' },
    )).toBe('sku_acabado');
  });

  it('linha de identidade acabada (Strass da ficha) é sempre Comprar pronto', () => {
    const strass = { identity_basis: 'finished_product_group' as const, identity_group_id: 'g', pv_origem: 'fabrica' };
    expect(resolveEffectiveStrapPvOrigem(strass, { id: 'm', origem_padrao: 'escolhe_no_pv' })).toBe('sku_acabado');
    expect(strapPvOrigemChooserValue(strass, { id: 'm' })).toBe('sku_acabado');
  });

  it('seletor: explícito > sourcing congelado > padrão do catálogo', () => {
    const lineId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const measure = { id: 'm1', origem_padrao: 'escolhe_no_pv' };
    const line = { technical_strap_line_id: lineId, measure_id: 'm1', pv_origem: null, group_id: 'g' };
    expect(strapPvOrigemChooserValue(line, measure)).toBe('fabrica');
    expect(strapPvOrigemChooserValue(line, measure, { [lineId]: { source_mode: 'buy_ready' as const } }))
      .toBe('sku_acabado');
    expect(strapPvOrigemChooserValue(
      { ...line, pv_origem: 'fabrica' },
      measure,
      { [lineId]: { source_mode: 'buy_ready' as const } },
    )).toBe('fabrica');
    expect(strapPvOrigemChooserValue(line, null)).toBeNull();
  });

  it('snapshot comprometido trava origem já escolhida, mas lacuna continua editável', () => {
    expect(isStrapPvOrigemChoiceLocked({
      committedSnapshot: true,
      pvOrigem: null,
    })).toBe(false);
    expect(isStrapPvOrigemChoiceLocked({
      committedSnapshot: true,
      pvOrigem: 'prestador',
    })).toBe(true);
    expect(isStrapPvOrigemChoiceLocked({
      committedSnapshot: true,
      pvOrigem: 'sku_acabado',
    })).toBe(true);
    expect(isStrapPvOrigemChoiceLocked({
      committedSnapshot: false,
      pvOrigem: 'fabrica',
    })).toBe(false);
    expect(isStrapPvOrigemChoiceLocked({
      committedSnapshot: true,
      productionExcluded: true,
      pvOrigem: null,
    })).toBe(true);
  });

  it('propaga a origem da posição para as outras cores do pedido', () => {
    const lineId = 'e64b24f5-d567-4913-bd59-b6e74f588c58';
    const previous = [
      { label: 'TIRA 2', technical_strap_line_id: lineId, measure_id: 'm1', pv_origem: null },
    ];
    const next = [
      { label: 'TIRA 2', technical_strap_line_id: lineId, measure_id: 'm1', pv_origem: 'sku_acabado' as const },
    ];
    const changes = collectStrapPvOrigemChanges(previous, next);
    expect(changes).toEqual([{ lineId, origem: 'sku_acabado' }]);
    const items = applyStrapPvOrigemChangesToItems(
      [
        { color: 'OFF WHITE', strap_colors: next },
        { color: 'NEW WHISKY', strap_colors: previous },
        { color: 'ROSADO', strap_colors: previous },
      ],
      0,
      changes,
    );
    expect(items.map((item) => item.strap_colors?.[0]?.pv_origem)).toEqual([
      'sku_acabado',
      'sku_acabado',
      'sku_acabado',
    ]);
  });

  it('sku_acabado explícito em medida padrão Prestador continua Comprar pronto', () => {
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: 'sku_acabado' },
      { id: 'm1', origem_padrao: 'escolhe_no_pv' },
    )).toBe('sku_acabado');
  });

  it('lista preço ausente conforme origem efetiva (prestador legado = Prestador)', () => {
    const issues = listStrapHubIncompleteForOrigem(
      [
        { label: 'A', measure_id: 'm1', pv_origem: 'fabrica' },
        { label: 'B', measure_id: 'm2', pv_origem: 'prestador' },
      ],
      [
        { id: 'm1', origem_padrao: 'escolhe_no_pv', preco_artesanal_per_m: null },
        { id: 'm2', origem_padrao: 'escolhe_no_pv', preco_artesanal_per_m: null, preco_prestador_per_m: 1.5 },
      ],
    );
    expect(issues.map((issue) => issue.code)).toEqual([
      'preco_artesanal_ausente',
      'preco_artesanal_ausente',
    ]);
    expect(issues.map((issue) => issue.measureId)).toEqual(['m1', 'm2']);
  });

  it('agrupa gaps de Hub por medida para o diálogo do PV', () => {
    const issues = listStrapHubIncompleteForOrigem(
      [
        { label: 'TIRA 1', measure_id: 'm1', pv_origem: 'prestador' },
        { label: 'TIRA 2', measure_id: 'm1', pv_origem: 'prestador' },
        { label: 'TIRA 3', measure_id: 'm2', pv_origem: 'fabrica' },
      ],
      [
        { id: 'm1', origem_padrao: 'escolhe_no_pv', preco_artesanal_per_m: null },
        { id: 'm2', origem_padrao: 'escolhe_no_pv', preco_artesanal_per_m: null },
      ],
    );
    const grouped = groupStrapHubIncompleteByMeasure(issues);
    expect(grouped).toHaveLength(2);
    const fazer = grouped.find((gap) => gap.measureId === 'm1');
    expect(fazer?.needsArtesanal).toBe(true);
    expect(fazer?.needsPrestador).toBe(false);
    expect(fazer?.labels).toEqual(['TIRA 1', 'TIRA 2']);
    expect(grouped.find((gap) => gap.measureId === 'm2')?.needsArtesanal).toBe(true);
  });

  it('Prestador usa só o preço da medida (preco_prestador_per_m legado não bloqueia)', () => {
    const issues = listStrapHubIncompleteForOrigem(
      [
        { label: 'TIRA 1', measure_id: 'm1', pv_origem: 'fabrica' },
        { label: 'TIRA 2', measure_id: 'm1', pv_origem: 'fabrica' },
      ],
      [
        {
          id: 'm1',
          origem_padrao: 'escolhe_no_pv',
          preco_artesanal_per_m: 0.8,
          preco_prestador_per_m: null,
        },
      ],
    );
    expect(issues).toEqual([]);
    expect(issues.some((issue) => issue.code === 'preco_prestador_ausente')).toBe(false);
  });

  it('exceção Prestador numa medida padrão Comprar pronto passa a cobrar a MO da medida', () => {
    const issues = listStrapHubIncompleteForOrigem(
      [{ label: 'STRASS', measure_id: 'm1', pv_origem: 'fabrica' }],
      [{ id: 'm1', origem_padrao: 'sempre_sku_acabado', preco_artesanal_per_m: null }],
    );
    expect(issues.map((issue) => issue.code)).toEqual(['preco_artesanal_ausente']);
    expect(issues[0].message).toContain('mão de obra do prestador');
  });

  it('frete/m exige Y > 0', () => {
    expect(strapFreightPerMeter(80, 1600)).toBeCloseTo(0.05);
    expect(strapFreightPerMeter(80, 0)).toBeNull();
    expect(strapFreightPerMeter(null, 1600)).toBeNull();
  });

  it('origem efetiva mapeia para source_mode do motor', () => {
    expect(sourceModeForEffectiveOrigem('sku_acabado')).toBe('buy_ready');
    expect(sourceModeForEffectiveOrigem('fabrica')).toBe('internal');
    expect(sourceModeForEffectiveOrigem('prestador')).toBe('internal');
    expect(sourceModeForEffectiveOrigem(null)).toBeNull();
  });

  it('padrão do catálogo preenche TODA linha sem escolha; explícito nunca é tocado', () => {
    const measures = [
      { id: 'm1', origem_padrao: 'escolhe_no_pv' },
      { id: 'm2', origem_padrao: 'sempre_fabrica' },
      { id: 'm3', origem_padrao: 'sempre_sku_acabado' },
      { id: 'm4' },
    ];
    const { lines, changed } = applyDefaultStrapPvOrigemChoices(
      [
        { label: 'Tira 1', measure_id: 'm1', pv_origem: null },
        { label: 'Tira 2', measure_id: 'm2', pv_origem: 'sku_acabado', group_id: 'g' },
        { label: 'Strass', measure_id: 'm3', group_id: 'g-strass' },
        { label: 'Strass sem grupo', measure_id: 'm3' },
        { label: 'Legado', measure_id: 'm4' },
        { label: 'Sem medida' },
      ],
      measures,
    );
    expect(changed).toBe(true);
    expect(lines.map((line) => line.pv_origem)).toEqual([
      'fabrica',
      'sku_acabado',
      'sku_acabado',
      'fabrica',
      'fabrica',
      undefined,
    ]);
    expect(applyDefaultStrapPvOrigemChoices(lines, measures).changed).toBe(false);
  });
});

describe('origem da tira no PV — uma escolha vale para todas as cores', () => {
  it('o painel copia pv_origem para os outros itens no mesmo write', () => {
    const panel = readFileSync(
      resolve(__dirname, '../../components/sale-orders/SaleOrderFormPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain('collectStrapPvOrigemChanges');
    expect(panel).toContain('applyStrapPvOrigemChangesToItems');
  });

  it('o save não bloqueia mais por "origem não escolhida" (R2: o padrão sempre se aplica)', () => {
    const page = readFileSync(
      resolve(__dirname, '../../pages/SaleOrderForm.tsx'),
      'utf8',
    );
    expect(page).not.toContain('firstMissingStrapPvOrigemMessage');
    expect(page).not.toContain('assertStrapOrigemChoiceReady');
    expect(page).toContain('coerceImpossibleBuyReadyStrapOrigem');
  });

  it('o seletor do item é sempre exibido, com padrão do catálogo e só Prestador | Comprar pronto', () => {
    const chooser = readFileSync(
      resolve(__dirname, '../../components/sale-orders/StrapPvOrigemChooser.tsx'),
      'utf8',
    );
    expect(chooser).not.toContain('Fazer');
    expect(chooser).not.toContain('Origem fixa no Hub');
    expect(chooser).toContain('STRAP_PV_ORIGEM_LABEL');
    expect(chooser).toContain('Padrão do catálogo');
    expect(chooser).toContain('Todas prestador');
    const form = readFileSync(
      resolve(__dirname, '../../components/sale-orders/SaleOrderItemForm.tsx'),
      'utf8',
    );
    expect(form).not.toContain('listMissingStrapPvOrigemChoices');
    expect(form).not.toContain("'Fazer (fábrica)'");
    expect(form).toContain('strapPvOrigemChooserValue');
  });

  it('o item oferece tira pronta em lote e avisa que a origem vale para todas as cores', () => {
    const form = readFileSync(
      resolve(__dirname, '../../components/sale-orders/SaleOrderItemForm.tsx'),
      'utf8',
    );
    expect(form).toContain('onAllBuyReady');
    expect(form).toContain('strapLineAllowsBuyReadyOrigem');
    expect(form).toContain('A origem vale para todas as cores do pedido.');
  });

  it('propaga Prestador com sourcing internal nas outras cores', () => {
    const lineId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const items = applyStrapPvOrigemChangesToItems(
      [
        {
          color: 'OFF WHITE',
          strap_colors: [{ label: 'TIRA 1', technical_strap_line_id: lineId, pv_origem: 'fabrica' }],
          strap_sourcing: { [lineId]: { source_mode: 'internal' } },
        },
        {
          color: 'PRATA',
          strap_colors: [{ label: 'TIRA 1', technical_strap_line_id: lineId, pv_origem: 'sku_acabado' }],
          strap_sourcing: {},
        },
      ],
      0,
      [{ lineId, origem: 'fabrica' }],
    );
    expect(items[1].strap_colors?.[0]?.pv_origem).toBe('fabrica');
    expect(items[1].strap_sourcing?.[lineId]?.source_mode).toBe('internal');
  });

  it('coerce sku_acabado sem group_id para Prestador no submit', () => {
    const { items, coerced } = coerceImpossibleBuyReadyStrapOrigem([
      {
        color: 'PRATA',
        strap_colors: [{
          label: 'TIRA 1',
          technical_strap_line_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          identity_basis: 'reference_base',
          pv_origem: 'sku_acabado',
          group_id: null,
        }],
      },
      {
        color: 'OFF WHITE',
        strap_colors: [{
          label: 'TIRA 1',
          technical_strap_line_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          identity_basis: 'reference_base',
          pv_origem: 'fabrica',
        }],
      },
    ]);
    expect(coerced).toEqual([{ color: 'PRATA', label: 'TIRA 1' }]);
    expect(items[0].strap_colors?.[0]?.pv_origem).toBe('fabrica');
    expect(items[1].strap_colors?.[0]?.pv_origem).toBe('fabrica');
  });
});

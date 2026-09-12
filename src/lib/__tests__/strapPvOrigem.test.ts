import {
  applyDefaultStrapPvOrigemChoices,
  DEFAULT_STRAP_PV_ORIGEM,
  groupStrapHubIncompleteByMeasure,
  listMissingStrapPvOrigemChoices,
  listStrapHubIncompleteForOrigem,
  resolveEffectiveStrapPvOrigem,
  sourceModeForEffectiveOrigem,
  strapFreightPerMeter,
} from '@/lib/strapPvOrigem';

describe('strapPvOrigem', () => {
  it('Hub fixo ganha sobre snapshot do PV', () => {
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: 'prestador' },
      { id: 'm1', origem_padrao: 'sempre_fabrica' },
    )).toBe('fabrica');
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: 'fabrica' },
      { id: 'm1', origem_padrao: 'sempre_sku_acabado' },
    )).toBe('sku_acabado');
  });

  it('escolhe_no_pv exige pv_origem', () => {
    const issues = listMissingStrapPvOrigemChoices(
      [
        { label: 'Tira 1', measure_id: 'm1', pv_origem: null },
        { label: 'Tira 2', measure_id: 'm2', pv_origem: 'fabrica' },
        { label: 'Tira 3', measure_id: 'm5', pv_origem: 'sku_acabado' },
        { label: 'Strass', measure_id: 'm3' },
        { label: 'Legado', measure_id: 'm4' },
      ],
      [
        { id: 'm1', origem_padrao: 'escolhe_no_pv' },
        { id: 'm2', origem_padrao: 'escolhe_no_pv' },
        { id: 'm5', origem_padrao: 'escolhe_no_pv' },
        { id: 'm3', origem_padrao: 'sempre_sku_acabado' },
        { id: 'm4' },
      ],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].label).toBe('Tira 1');
    expect(issues[0].message).toContain('Fornecedor');
  });

  it('escolhe_no_pv aceita sku_acabado como origem explícita', () => {
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: 'sku_acabado' },
      { id: 'm1', origem_padrao: 'escolhe_no_pv' },
    )).toBe('sku_acabado');
    expect(listMissingStrapPvOrigemChoices(
      [{ label: 'TIRA 2', measure_id: 'm1', pv_origem: 'sku_acabado' }],
      [{ id: 'm1', origem_padrao: 'escolhe_no_pv' }],
    )).toEqual([]);
  });

  it('lista preço ausente conforme origem efetiva', () => {
    const issues = listStrapHubIncompleteForOrigem(
      [
        { label: 'A', measure_id: 'm1', pv_origem: 'fabrica' },
        { label: 'B', measure_id: 'm2', pv_origem: 'prestador' },
      ],
      [
        { id: 'm1', origem_padrao: 'escolhe_no_pv', preco_artesanal_per_m: null },
        { id: 'm2', origem_padrao: 'escolhe_no_pv', preco_prestador_per_m: 1.5 },
      ],
    );
    expect(issues.map((issue) => issue.code)).toEqual(['preco_artesanal_ausente']);
    expect(issues[0].measureId).toBe('m1');
  });

  it('agrupa gaps de Hub por medida para o diálogo do PV', () => {
    const issues = listStrapHubIncompleteForOrigem(
      [
        { label: 'TIRA 1', measure_id: 'm1', pv_origem: 'prestador' },
        { label: 'TIRA 2', measure_id: 'm1', pv_origem: 'prestador' },
        { label: 'TIRA 3', measure_id: 'm2', pv_origem: 'fabrica' },
      ],
      [
        { id: 'm1', origem_padrao: 'escolhe_no_pv', preco_prestador_per_m: null },
        { id: 'm2', origem_padrao: 'escolhe_no_pv', preco_artesanal_per_m: null },
      ],
    );
    const grouped = groupStrapHubIncompleteByMeasure(issues);
    expect(grouped).toHaveLength(2);
    const prestador = grouped.find((gap) => gap.measureId === 'm1');
    expect(prestador?.needsPrestador).toBe(true);
    expect(prestador?.labels).toEqual(['TIRA 1', 'TIRA 2']);
    expect(grouped.find((gap) => gap.measureId === 'm2')?.needsArtesanal).toBe(true);
  });

  it('fábrica nunca exige mão de obra do prestador (mesmo sem preco_prestador)', () => {
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

  it('Hub sempre_fabrica ignora pv_origem=prestador residual e não cobra MO', () => {
    const issues = listStrapHubIncompleteForOrigem(
      [{ label: 'TIRA 1', measure_id: 'm1', pv_origem: 'prestador' }],
      [{
        id: 'm1',
        origem_padrao: 'sempre_fabrica',
        preco_artesanal_per_m: 1,
        preco_prestador_per_m: null,
      }],
    );
    expect(issues.map((issue) => issue.code)).toEqual([]);
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

  it('padrão comprar pronto (= prestador) só preenche escolhe_no_pv vazio', () => {
    const { lines, changed } = applyDefaultStrapPvOrigemChoices(
      [
        { label: 'Tira 1', measure_id: 'm1', pv_origem: null },
        { label: 'Tira 2', measure_id: 'm2', pv_origem: 'fabrica' },
        { label: 'Strass', measure_id: 'm3' },
        { label: 'Legado', measure_id: 'm4' },
      ],
      [
        { id: 'm1', origem_padrao: 'escolhe_no_pv' },
        { id: 'm2', origem_padrao: 'escolhe_no_pv' },
        { id: 'm3', origem_padrao: 'sempre_sku_acabado' },
        { id: 'm4' },
      ],
    );
    expect(changed).toBe(true);
    expect(lines[0].pv_origem).toBe(DEFAULT_STRAP_PV_ORIGEM);
    expect(DEFAULT_STRAP_PV_ORIGEM).toBe('prestador');
    expect(lines[1].pv_origem).toBe('fabrica');
    expect(lines[2].pv_origem).toBeUndefined();
    expect(lines[3].pv_origem).toBeUndefined();
    expect(applyDefaultStrapPvOrigemChoices(lines, [
      { id: 'm1', origem_padrao: 'escolhe_no_pv' },
      { id: 'm2', origem_padrao: 'escolhe_no_pv' },
      { id: 'm3', origem_padrao: 'sempre_sku_acabado' },
      { id: 'm4' },
    ]).changed).toBe(false);
  });
});

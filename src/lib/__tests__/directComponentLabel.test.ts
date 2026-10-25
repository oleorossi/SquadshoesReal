import { describe, it, expect } from 'vitest';
import {
  directComponentDisplayName,
  directComponentDisplayUnit,
  refreshDirectComponentLabels,
} from '@/lib/directComponentLabel';

/**
 * Caso real (PV-00236, 13/10/2026): o SKU 8440419756 foi renomeado de
 * "Binóculo 10mm Strass" para "Pedra Amassada KR" em 17/09/2026. As fichas DS20 e
 * S-039, salvas antes do rename, congelaram o nome antigo em
 * direct_components[].product_name — e o dono perguntou de onde vinha a
 * "pedra amassada" no consumo, porque consumo/débito/custeio já usavam
 * products.name ao vivo. Nenhum teste cobria "produto ATIVO renomeado deixa o
 * rótulo desatualizado" antes disto.
 */
const PEDRA = {
  id: '582dfea9-b246-4634-bca8-efe2f3738940',
  name: 'Pedra Amassada KR',
  unit: 'un',
  group_id: 'g-comp',
  groupName: 'COMPONENTES DIVERSOS',
};
const BINOCULO = {
  id: '672fcd3d-3a84-4892-b61c-f5956180dc84',
  name: 'Binóculo 10mm',
  unit: 'un',
  group_id: 'g-comp',
  groupName: 'COMPONENTES DIVERSOS',
};
const ELASTICO = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name: 'ELÁSTICO FORRADO 7 mm · NAPA SOFT · OFF WHITE',
  unit: 'm',
  group_id: 'g-el',
  groupName: 'ELÁSTICO FORRADO 7MM',
};

describe('directComponentDisplayName', () => {
  it('produto vivo vence o rótulo gravado (o bug do rename)', () => {
    const comp = { product_id: PEDRA.id, product_name: 'Binóculo 10mm Strass' };
    expect(directComponentDisplayName(comp, PEDRA, 0)).toBe('Pedra Amassada KR');
  });

  it('cai no rótulo gravado quando o produto saiu do estoque', () => {
    const comp = { product_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', product_name: 'BINÓCULO 6MM' };
    expect(directComponentDisplayName(comp, undefined, 2)).toBe('BINÓCULO 6MM');
  });

  it('nome vivo em branco não apaga o rótulo gravado', () => {
    const comp = { product_id: PEDRA.id, product_name: 'Binóculo 10mm Strass' };
    expect(directComponentDisplayName(comp, { id: PEDRA.id, name: '   ' }, 0))
      .toBe('Binóculo 10mm Strass');
  });

  it('sem nome nenhum usa o genérico pela posição', () => {
    expect(directComponentDisplayName({ product_id: 'x' }, null, 3)).toBe('Componente 4');
    expect(directComponentDisplayName({ product_id: 'x' }, null)).toBe('Componente');
  });
});

describe('directComponentDisplayUnit', () => {
  it('unidade viva vence snapshot un mentiroso', () => {
    expect(directComponentDisplayUnit(
      { product_id: ELASTICO.id, unit: 'un' },
      ELASTICO,
    )).toBe('m');
  });

  it('sem SKU / sem unidade → null (rótulo sem parênteses)', () => {
    expect(directComponentDisplayUnit({ product_id: null, unit: null }, null)).toBeNull();
    expect(directComponentDisplayUnit({}, undefined)).toBeNull();
  });

  it('cai no snapshot quando o produto sumiu', () => {
    expect(directComponentDisplayUnit(
      { product_id: 'dead', unit: 'cm' },
      null,
    )).toBe('cm');
  });
});

describe('refreshDirectComponentLabels', () => {
  it('realinha nome, unit e grupo — NÃO toca em quantidade, preço nem setor', () => {
    const components = [
      {
        product_id: BINOCULO.id,
        product_name: 'Binóculo 10mm',
        quantity: 4,
        unit_price: 0.1,
        unit: 'un',
        group_id: 'g-comp',
        group_name: 'COMPONENTES DIVERSOS',
        consumption_sector: 'Aviamento',
      },
      {
        product_id: ELASTICO.id,
        product_name: 'ELÁSTICO FORRADO 7MM',
        quantity: 20,
        unit_price: 1.5,
        unit: 'un',
        group_id: null,
        group_name: null,
        consumption_sector: 'Aviamento',
      },
    ];
    const out = refreshDirectComponentLabels(components, [BINOCULO, ELASTICO]);
    expect(out[1]).toEqual({
      product_id: ELASTICO.id,
      product_name: ELASTICO.name,
      quantity: 20,
      unit_price: 1.5,
      unit: 'm',
      group_id: 'g-el',
      group_name: 'ELÁSTICO FORRADO 7MM',
      consumption_sector: 'Aviamento',
    });
    // a linha que já estava certa sai pela MESMA referência
    expect(out[0]).toBe(components[0]);
  });

  it('preserva o snapshot de componente cujo produto saiu do estoque', () => {
    const components = [{ product_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', product_name: 'BINÓCULO 6MM', quantity: 4, unit: 'un' }];
    const out = refreshDirectComponentLabels(components, [BINOCULO, PEDRA]);
    expect(out[0].product_name).toBe('BINÓCULO 6MM');
    expect(out[0]).toBe(components[0]);
  });

  it('preenche rótulo vazio da linha recém-adicionada', () => {
    const out = refreshDirectComponentLabels(
      [{ product_id: PEDRA.id, product_name: '', quantity: 1 }],
      [PEDRA],
    );
    expect(out[0].product_name).toBe('Pedra Amassada KR');
  });

  it('ignora linha sem product_id (não inventa rótulo)', () => {
    const components = [{ product_id: '', product_name: '', quantity: 1 }];
    const out = refreshDirectComponentLabels(components, [PEDRA]);
    expect(out[0]).toBe(components[0]);
  });

  it('é idempotente', () => {
    const components = [{
      product_id: ELASTICO.id,
      product_name: 'velho',
      unit: 'un',
      group_id: null,
      group_name: null,
      quantity: 4,
    }];
    const once = refreshDirectComponentLabels(components, [ELASTICO]);
    const twice = refreshDirectComponentLabels(once, [ELASTICO]);
    expect(twice).toEqual(once);
    expect(twice[0]).toBe(once[0]);
  });

  it('lista de produtos vazia ou ausente nunca apaga rótulo', () => {
    const components = [{ product_id: PEDRA.id, product_name: 'Binóculo 10mm Strass', quantity: 4 }];
    expect(refreshDirectComponentLabels(components, [])).toBe(components);
    expect(refreshDirectComponentLabels(components, null)).toBe(components);
    expect(refreshDirectComponentLabels(components, [{ id: PEDRA.id, name: null }])).toBe(components);
  });

  it('entrada nula vira array vazio', () => {
    expect(refreshDirectComponentLabels(null, [PEDRA])).toEqual([]);
    expect(refreshDirectComponentLabels(undefined, [PEDRA])).toEqual([]);
  });
});

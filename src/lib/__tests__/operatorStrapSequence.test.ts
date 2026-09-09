import { describe, expect, it } from 'vitest';
import {
  effectiveOperatorStrapColor,
  effectiveOperatorStrapMaterial,
  operatorStrapGroupingSignature,
  operatorStrapSequence,
} from '@/lib/operatorStrapSequence';

describe('operatorStrapSequence', () => {
  it('usa material efetivo do snapshot e distingue duas bases do mesmo tipo/cor', () => {
    const base = { id: '11111111-1111-4111-8111-111111111111', color: 'AZUL',
      group_name: 'TIRA OVERLOCK 5MM' };
    const first = { ...base, base_group_id: 'grupo-1', base_group_name: 'NAPA SOFT' };
    const second = { ...base, base_group_id: 'grupo-2', base_group_name: 'NAPA SOFT + MASSABOX' };
    expect(effectiveOperatorStrapMaterial(second)).toBe('NAPA SOFT + MASSABOX');
    expect(effectiveOperatorStrapMaterial(base)).toBe('TIRA OVERLOCK 5MM');
    expect(operatorStrapGroupingSignature([first])).not.toBe(operatorStrapGroupingSignature([second]));
  });

  it('preserva a posição do array quando as linhas têm UUID', () => {
    const lines = [
      { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', label: 'TIRA 1', color: 'Azul' },
      { id: '11111111-1111-4111-8111-111111111111', label: 'TIRA 2', color: 'Branco' },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'TIRA 3', color: 'Vermelho' },
    ];

    expect(operatorStrapSequence(lines).map((line) => line.label)).toEqual([
      'TIRA 1',
      'TIRA 2',
      'TIRA 3',
    ]);
  });

  it('mantém a ordenação numérica dos snapshots legados', () => {
    const lines = [
      { id: '3', label: 'TIRA 3' },
      { id: '1', label: 'TIRA 1' },
      { id: '2', label: 'TIRA 2' },
    ];

    expect(operatorStrapSequence(lines).map((line) => line.label)).toEqual([
      'TIRA 1',
      'TIRA 2',
      'TIRA 3',
    ]);
  });

  it('não tenta ordenar uma mistura de identidades antigas e canônicas', () => {
    const lines = [
      { id: '2', label: 'posição preservada 1' },
      { id: '11111111-1111-4111-8111-111111111111', label: 'posição preservada 2' },
    ];

    expect(operatorStrapSequence(lines).map((line) => line.label)).toEqual([
      'posição preservada 1',
      'posição preservada 2',
    ]);
  });

  it('não infere posição pelo id legado quando há UUID técnico', () => {
    const lines = [
      {
        id: '2',
        technical_strap_line_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        label: 'TIRA 1',
      },
      {
        id: '1',
        technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
        label: 'TIRA 2',
      },
    ];

    expect(operatorStrapSequence(lines).map((line) => line.label)).toEqual([
      'TIRA 1',
      'TIRA 2',
    ]);
  });

  it('reconhece como canônica uma identidade UUID fora das versões antigas', () => {
    const lines = [
      { id: '2', technical_strap_line_id: '0198f35c-7f4d-7000-8000-000000000001', label: 'primeira' },
      { id: '1', technical_strap_line_id: '0198f35c-7f4d-7000-8000-000000000002', label: 'segunda' },
    ];

    expect(operatorStrapSequence(lines).map((line) => line.label)).toEqual([
      'primeira',
      'segunda',
    ]);
  });
});

describe('effectiveOperatorStrapColor', () => {
  it('usa a cor congelada da linha do PV antes da cor principal', () => {
    expect(effectiveOperatorStrapColor({ color: 'Azul' }, 'Preto')).toBe('Azul');
  });

  it('preserva ficha antiga usando a cor principal quando a linha não tem cor', () => {
    expect(effectiveOperatorStrapColor({}, 'Preto')).toBe('Preto');
    expect(effectiveOperatorStrapColor({}, '')).toBe('—');
  });

  it('não imprime a cor do calçado como escolha ausente de tira independente', () => {
    expect(effectiveOperatorStrapColor({ color_mode: 'select_on_order', color: '' }, 'COBRE')).toBe('—');
    expect(effectiveOperatorStrapColor({ identity_basis: 'finished_product_group', color: '' }, 'COBRE')).toBe('—');
    expect(effectiveOperatorStrapColor({ color_mode: 'follow_main', color: '' }, 'COBRE')).toBe('COBRE');
  });
});

describe('operatorStrapGroupingSignature', () => {
  const line = {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    technical_strap_line_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    strap_type_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    measure_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    label: 'TIRA 1',
    color: 'Azul',
    color_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    consumption: 42,
    consumption_per_size: { '34': 41, '35': 42 },
  };

  it('separa snapshots históricos com consumo escalar diferente', () => {
    const current = operatorStrapGroupingSignature([line], 'Preto');
    const historical = operatorStrapGroupingSignature([
      { ...line, consumption: 40 },
    ], 'Preto');

    expect(current).not.toBe(historical);
  });

  it('separa snapshots quando uma medida por numeração muda', () => {
    const current = operatorStrapGroupingSignature([line], 'Preto');
    const historical = operatorStrapGroupingSignature([
      { ...line, consumption_per_size: { '34': 40, '35': 42 } },
    ], 'Preto');

    expect(current).not.toBe(historical);
  });

  it('inclui identidade técnica, medida, rótulo e cor na assinatura', () => {
    const base = operatorStrapGroupingSignature([line], 'Preto');

    expect(operatorStrapGroupingSignature([
      { ...line, technical_strap_line_id: '11111111-1111-4111-8111-111111111111' },
    ], 'Preto')).not.toBe(base);
    expect(operatorStrapGroupingSignature([
      { ...line, measure_id: '22222222-2222-4222-8222-222222222222' },
    ], 'Preto')).not.toBe(base);
    expect(operatorStrapGroupingSignature([
      { ...line, label: 'TIRA TRASEIRA' },
    ], 'Preto')).not.toBe(base);
    expect(operatorStrapGroupingSignature([
      { ...line, color: 'Branco' },
    ], 'Preto')).not.toBe(base);
  });

  it('separa a base da referência de um grupo de tira comprado pronto', () => {
    const inherited = operatorStrapGroupingSignature([{ ...line, identity_basis: 'reference_base' }]);
    const finished = operatorStrapGroupingSignature([{ ...line, identity_basis: 'finished_product_group' }]);

    expect(inherited).not.toBe(finished);
  });

  it.each(['identity_group_id', 'group_id'])('separa materiais distintos por %s mesmo com mesma cor e medida', field => {
    const first = operatorStrapGroupingSignature([{
      ...line, [field]: '11111111-1111-4111-8111-111111111111',
    }]);
    const second = operatorStrapGroupingSignature([{
      ...line, [field]: '22222222-2222-4222-8222-222222222222',
    }]);

    expect(first).not.toBe(second);
  });

  it('não oculta a diferença de material de snapshots legados sem grupo canônico', () => {
    const pure = operatorStrapGroupingSignature([{ ...line, group_name: 'NAPA SOFT' }]);
    const composite = operatorStrapGroupingSignature([{ ...line, group_name: 'NAPA SOFT + MASSABOX' }]);

    expect(pure).not.toBe(composite);
  });

  it('preserva compatibilidade da identidade legada e neutraliza só a grafia do material', () => {
    const legacy = operatorStrapGroupingSignature([{ ...line, group_name: ' napa soft ' }]);
    const canonical = operatorStrapGroupingSignature([{
      ...line, identity_basis: 'reference_base', identity_group_id: null, group_id: null, group_name: 'NAPA SOFT',
    }]);

    expect(legacy).toBe(canonical);
  });

  it('preserva a sequência técnica do array sem ordenar UUID', () => {
    const second = {
      ...line,
      id: '11111111-1111-4111-8111-111111111111',
      technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
      label: 'TIRA 2',
    };

    const inTechnicalOrder = operatorStrapGroupingSignature([line, second], 'Preto');
    const reversed = operatorStrapGroupingSignature([second, line], 'Preto');

    expect(inTechnicalOrder).not.toBe(reversed);
    expect(inTechnicalOrder.indexOf(line.technical_strap_line_id))
      .toBeLessThan(inTechnicalOrder.indexOf(second.technical_strap_line_id));
  });

  it('neutraliza apenas ordem das chaves e representação numérica do consumo', () => {
    const current = operatorStrapGroupingSignature([line], 'Preto');
    const equivalent = operatorStrapGroupingSignature([{
      ...line,
      consumption: '42.0',
      consumption_per_size: { '35': '42.0', '34': '41.0' },
    }], 'Preto');

    expect(equivalent).toBe(current);
  });

  it('mantém fallback da cor principal e vazio para modelo sem tiras', () => {
    const legacy = { ...line, color: null, color_id: null };

    expect(operatorStrapGroupingSignature([legacy], 'Preto')).toContain('PRETO');
    expect(operatorStrapGroupingSignature([], 'Preto')).toBe('');
  });
});

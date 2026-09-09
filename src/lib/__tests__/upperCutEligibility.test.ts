import { describe, expect, it } from 'vitest';
import { getUpperWorkEligibility, requiresUpperCut } from '@/lib/upperCutEligibility';

describe('requiresUpperCut', () => {
  it('mantém Corte Cabedal quando cabedal e tiras coexistem', () => {
    expect(requiresUpperCut({
      upper_material: 'NAPA SOFT',
      upper_consumption: 2.74,
      // A flag não faz parte do contrato do helper de propósito.
      has_straps: true,
    } as never)).toBe(true);
  });

  it('não cria Corte Cabedal para modelo somente de tiras', () => {
    expect(requiresUpperCut({
      upper_material: '',
      upper_material_group_id: null,
      upper_material_product_id: null,
      upper_consumption: 0,
      upper_consumption_per_size: {},
    })).toBe(false);
  });

  it('não esconde cadastro parcial: identidade ou consumo isolado já sinalizam o corte', () => {
    expect(requiresUpperCut({ upper_material_group_id: 'grupo-napa' })).toBe(true);
    expect(requiresUpperCut({ upper_consumption_per_size: { 34: 2.5 } })).toBe(true);
  });

  it('considera material adicional obrigatório como consumo de cabedal', () => {
    expect(requiresUpperCut({
      components_accessories: [{
        mandatory: true,
        material: 'NAPA MASSABOX',
        consumption: 2.28,
      }],
    })).toBe(true);
  });

  it('considera alternativa por cor como caminho real de consumo de cabedal', () => {
    expect(requiresUpperCut({
      components_accessories: [{
        mandatory: false,
        material: 'NAPA ALTERNATIVA',
        consumption: 2.28,
      }],
    })).toBe(true);
  });

  it('ignora componente genérico legado que não pertence ao slot de cabedal', () => {
    expect(requiresUpperCut({
      components_accessories: [{
        id: 'componente-direto',
        material: 'FIVELA',
        consumption: 2,
      }],
    })).toBe(false);
  });

  it('particiona grupos de impressão quando cabedal e somente tiras colidem', () => {
    const cabedalComTiras = getUpperWorkEligibility({
      upper_material: 'NAPA SOFT',
      upper_consumption: 2.74,
    });
    const somenteTiras = getUpperWorkEligibility({
      upper_material: '',
      upper_consumption: 0,
    });
    const cabedalCorteAFio = getUpperWorkEligibility({
      upper_material: 'NAPA SOFT',
      upper_consumption: 2.74,
      upper_corte_a_fio: true,
    });

    expect(cabedalComTiras.partitionKey).not.toBe(somenteTiras.partitionKey);
    expect(cabedalComTiras.partitionKey).not.toBe(cabedalCorteAFio.partitionKey);
    expect(cabedalComTiras).toMatchObject({
      requiresUpperCut: true,
      requiresUpperSewing: true,
    });
    expect(somenteTiras).toMatchObject({
      requiresUpperCut: false,
      requiresUpperSewing: false,
    });
  });
});

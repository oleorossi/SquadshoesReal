import { describe, expect, it } from 'vitest';
import { applyClientCommercialDefaultsToForm } from '@/lib/saleOrderCommercialDefaults';

describe('applyClientCommercialDefaultsToForm', () => {
  const defaults = {
    payment_condition: '30/60',
    factoring_config_id: 'fact-default-uuid',
  };

  it('em criação preenche factoring e payment vazios com o default do cliente', () => {
    const next = applyClientCommercialDefaultsToForm(
      { payment_condition: '', factoring_config_id: '' },
      defaults,
      { isEdit: false },
    );
    expect(next.payment_condition).toBe('30/60');
    expect(next.factoring_config_id).toBe('fact-default-uuid');
  });

  it('em edição NÃO injeta factoring_config_id quando o PV está sem factoring', () => {
    const next = applyClientCommercialDefaultsToForm(
      { payment_condition: '', factoring_config_id: '', is_factoring: false },
      defaults,
      { isEdit: true },
    );
    expect(next.factoring_config_id).toBe('');
    expect(next.payment_condition).toBe('30/60');
  });

  it('em edição preserva factoring já gravado e payment já preenchido', () => {
    const next = applyClientCommercialDefaultsToForm(
      {
        payment_condition: 'à vista',
        factoring_config_id: 'fact-already-set',
      },
      defaults,
      { isEdit: true },
    );
    expect(next.payment_condition).toBe('à vista');
    expect(next.factoring_config_id).toBe('fact-already-set');
  });

  it('em criação não sobrescreve valores que o usuário já escolheu', () => {
    const next = applyClientCommercialDefaultsToForm(
      {
        payment_condition: '15 dias',
        factoring_config_id: 'fact-user-picked',
      },
      defaults,
      { isEdit: false },
    );
    expect(next.payment_condition).toBe('15 dias');
    expect(next.factoring_config_id).toBe('fact-user-picked');
  });
});

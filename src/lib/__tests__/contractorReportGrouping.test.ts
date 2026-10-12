import { describe, expect, it } from 'vitest';
import {
  hasResolvedReference,
  referenceGroupLabel,
} from '@/lib/contractorReportGrouping';

describe('referenceGroupLabel', () => {
  it('usa a referência quando a view conseguiu derivar', () => {
    expect(referenceGroupLabel({ reference_label: 'I90', reference_source: 'item' })).toBe('I90');
    expect(referenceGroupLabel({ reference_label: 'SR01', reference_source: 'pv_referencia_unica' }))
      .toBe('SR01');
  });

  it('distingue PV ambíguo de OS avulsa — são problemas diferentes', () => {
    expect(referenceGroupLabel({ reference_label: null, reference_source: 'pv_varias_referencias' }))
      .toBe('Pedido inteiro · várias referências');
    expect(referenceGroupLabel({ reference_label: null, reference_source: 'sem_pedido' }))
      .toBe('OS avulsa · sem pedido vinculado');
  });

  it('motivo desconhecido não finge referência', () => {
    expect(referenceGroupLabel({ reference_label: null, reference_source: null }))
      .toBe('Referência não identificada');
    expect(referenceGroupLabel({ reference_label: null, reference_source: 'algo_novo' }))
      .toBe('Referência não identificada');
  });

  it('rótulo só com espaço conta como ausente', () => {
    expect(referenceGroupLabel({ reference_label: '   ', reference_source: 'sem_pedido' }))
      .toBe('OS avulsa · sem pedido vinculado');
  });

  it('hasResolvedReference separa nome real de explicação', () => {
    expect(hasResolvedReference({ reference_label: 'I90', reference_source: 'item' })).toBe(true);
    expect(hasResolvedReference({ reference_label: null, reference_source: 'sem_pedido' })).toBe(false);
    expect(hasResolvedReference({ reference_label: ' ', reference_source: 'item' })).toBe(false);
  });
});

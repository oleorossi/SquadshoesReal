import { describe, expect, it } from 'vitest';
import { kitShortageBlockMessage, kitShortageLabels, lotHasKitShortage } from '@/lib/atelierKitShortage';

describe('atelierKitShortage', () => {
  it('não marca falta sem débitos', () => {
    expect(lotHasKitShortage(undefined)).toBe(false);
    expect(lotHasKitShortage([])).toBe(false);
    expect(kitShortageLabels([])).toEqual([]);
  });

  it('marca falta quando pending_qty > 0', () => {
    const debits = [
      { product_name: 'NAPA PRETA', pending_qty: 0, component: 'Cabedal' },
      { product_name: 'ELÁSTICO', pending_qty: 12.5, component: 'Aviamento' },
    ];
    expect(lotHasKitShortage(debits)).toBe(true);
    expect(kitShortageLabels(debits)).toEqual(['ELÁSTICO: faltam 12,5']);
  });

  it('cita cor, unidade e estoque no bloqueio do cartão', () => {
    const debits = [
      { product_name: 'NAPA SOFT', color: 'NATURAL', unit: 'm', pending_qty: 48, available_qty: 0, component: 'Cabedal' },
    ];
    expect(kitShortageLabels(debits)).toEqual(['NAPA SOFT NATURAL: faltam 48 m (estoque 0 m)']);
    expect(kitShortageBlockMessage(debits)).toContain('enviar com ressalva');
    expect(kitShortageBlockMessage(debits)).toContain('NAPA SOFT NATURAL');
  });

  it('ignora pending nulo/zero', () => {
    expect(
      lotHasKitShortage([
        { product_name: 'A', pending_qty: null },
        { product_name: 'B', pending_qty: 0 },
      ]),
    ).toBe(false);
  });
});

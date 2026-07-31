import { describe, it, expect } from 'vitest';
import { indexStrapPickingLines, strapNapaSubline, strapPickingKey } from '@/lib/strapPickingLines';

/**
 * GATE do picking em UMA linha (spec §2.5): a tira em destaque e a napa embaixo,
 * na mesma linha. Errar o casamento aqui não dá erro — some a napa da ficha de
 * separação e o separador vai procurar uma tira que não existe na prateleira.
 */
const reserva = (over: Record<string, unknown> = {}, qty = 2.32) => ({
  quantity_reserved: qty,
  metadata: {
    kind: 'strap',
    color: 'CAPUCCINO',
    label: 'TIRA 1',
    sourcing: 'in_house',
    product_name: 'NAPA SOFT',
    strap_product_name: 'Tira chata 8mm',
    strap_required_m: 139.2,
    yield_per_meter: 60,
    ...over,
  },
});

describe('indexStrapPickingLines', () => {
  it('casa tanto pelo nome da tira quanto pelo rótulo da ficha', () => {
    const idx = indexStrapPickingLines([reserva()]);
    const byName = idx.get(strapPickingKey('Tira chata 8mm', 'CAPUCCINO'));
    const byLabel = idx.get(strapPickingKey('TIRA 1', 'capuccino'));
    expect(byName).toBeDefined();
    expect(byLabel).toBe(byName);
  });

  it('acrescenta a COR ao nome da napa (1 produto por cor sob o mesmo nome)', () => {
    const line = indexStrapPickingLines([reserva()]).get(strapPickingKey('Tira chata 8mm', 'CAPUCCINO'))!;
    expect(line.napaName).toBe('NAPA SOFT CAPUCCINO');
  });

  it('não repete a cor quando o cadastro já a embute no nome', () => {
    const line = indexStrapPickingLines([reserva({ product_name: 'NAPA SOFT: CAPUCCINO' })])
      .get(strapPickingKey('Tira chata 8mm', 'CAPUCCINO'))!;
    expect(line.napaName).toBe('NAPA SOFT: CAPUCCINO');
  });

  it('soma as duas grandezas entre as OPs do lote', () => {
    const line = indexStrapPickingLines([reserva(), reserva()])
      .get(strapPickingKey('Tira chata 8mm', 'CAPUCCINO'))!;
    expect(line.strapRequiredM).toBeCloseTo(278.4, 4);
    expect(line.napaRequired).toBeCloseTo(4.64, 4);
  });

  it('reserva de tira COMPRADA PRONTA não gera sublinha — não há napa', () => {
    const idx = indexStrapPickingLines([
      reserva({ sourcing: 'purchased', strap_product_name: undefined, product_name: 'Tira chata 8mm' }),
    ]);
    expect(idx.size).toBe(0);
  });

  it('reserva anterior ao cutover (legacy, sem os campos do motor) é ignorada', () => {
    const idx = indexStrapPickingLines([
      { quantity_reserved: 5, metadata: { kind: 'strap', color: 'BEGE', sourcing: 'legacy', product_name: 'Tira chata 8mm' } },
    ]);
    expect(idx.size).toBe(0);
  });

  it('ignora reservas que não são de tira', () => {
    expect(indexStrapPickingLines([{ quantity_reserved: 9, metadata: { kind: 'sole' } }]).size).toBe(0);
    expect(indexStrapPickingLines([{ quantity_reserved: 9, metadata: null }]).size).toBe(0);
  });
});

describe('strapNapaSubline', () => {
  it('escreve a linha no formato decidido na spec', () => {
    const line = indexStrapPickingLines([reserva()]).get(strapPickingKey('Tira chata 8mm', 'CAPUCCINO'))!;
    expect(strapNapaSubline(line)).toBe('consome 2,32 m de NAPA SOFT CAPUCCINO (rend. 60 m/m)');
  });
});

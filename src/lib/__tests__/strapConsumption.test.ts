import { describe, it, expect } from 'vitest';
import { calculateStrapConsumptionCm, resolveOrderStraps } from '@/lib/strapConsumption';

/**
 * GATE do motor de consumo de tira (cm/par) — `calculateStrapConsumptionCm`.
 *
 * Contrato CANÔNICO (trava a paridade com o SQL `debit_strap_stock`):
 *   - O consumo armazenado (`consumption` e `consumption_per_size[size]`) está em
 *     **cm POR PAR** — a UI exibe por PÉ (÷2) e salva por PAR (×2), mas o motor lê o
 *     valor de storage CRU, por par. NÃO há ÷2/×2 aqui.
 *   - Tira é LINEAR NATIVA → o motor devolve cm direto; quem converte pra metros é o
 *     caller (÷100). Nunca passa por conversão de área (dm²).
 *   - Com `consumption_per_size` + grade: soma por numeração × fichas, espelhando o SQL
 *     `v_total_cm = Σ(pairs × cm_per_pair)`, `v_fichas = qty / grade_total` — EXATO por
 *     quantidade (2026-07-01): SEM arredondar pra ficha cheia (era `GREATEST(1, ceil(...))`).
 *   - Sem per-size (ou sem grade): consumo escalar × quantidade total.
 *
 * Referência SQL: migration 20260805120000 + 20260701..._strap-consumption-exact-by-quantity.
 */

describe('calculateStrapConsumptionCm — escalar (sem per-size)', () => {
  it('consumption × quantidade total (cm/par × pares)', () => {
    // 40 cm/par × 120 pares = 4800 cm (= 48 m após o ÷100 do caller).
    const cm = calculateStrapConsumptionCm({ consumption: 40 }, { quantity: 120 });
    expect(cm).toBe(4800);
  });

  it('quantity ≤ 0 → 0 (nada a consumir)', () => {
    expect(calculateStrapConsumptionCm({ consumption: 40 }, { quantity: 0 })).toBe(0);
    expect(calculateStrapConsumptionCm({ consumption: 40 }, { quantity: -10 })).toBe(0);
  });

  it('consumption ausente/0 → 0 (não inventa consumo)', () => {
    expect(calculateStrapConsumptionCm({ consumption: 0 }, { quantity: 120 })).toBe(0);
    expect(calculateStrapConsumptionCm({}, { quantity: 120 })).toBe(0);
  });

  it('per-size presente mas SEM grade → cai no escalar', () => {
    const cm = calculateStrapConsumptionCm(
      { consumption: 40, consumption_per_size: { '35': 38, '40': 42 } },
      { quantity: 100 }, // sem grade
    );
    expect(cm).toBe(4000); // 40 × 100 (per-size ignorado sem grade)
  });
});

describe('calculateStrapConsumptionCm — per-size por numeração (espelha o SQL)', () => {
  it('soma por numeração × fichas (fichas explícito)', () => {
    // grade base: 35→2, 36→3 (5 pares/ficha). consumo: 35→38, 36→40 cm/par.
    // totalPerFicha = 2×38 + 3×40 = 196 cm. fichas=10 → 1960 cm.
    const cm = calculateStrapConsumptionCm(
      { consumption: 40, consumption_per_size: { '35': 38, '36': 40 } },
      { grade: { '35': 2, '36': 3 }, quantity: 50, fichas: 10 },
    );
    expect(cm).toBe(1960);
  });

  it('fichas inferido = quantity / grade_total — EXATO por quantidade (sem ceil)', () => {
    // grade_total = 5; quantity = 52 → 52/5 = 10,4 fichas (fração exata, NÃO ceil=11).
    // totalPerFicha = 2×38 + 3×40 = 196 → 196 × 10,4 = 2038,4 cm.
    const cm = calculateStrapConsumptionCm(
      { consumption: 40, consumption_per_size: { '35': 38, '36': 40 } },
      { grade: { '35': 2, '36': 3 }, quantity: 52 },
    );
    expect(cm).toBeCloseTo(2038.4, 4);
  });

  it('ficha parcial (quantity < grade_total) consome a FRAÇÃO exata (não arredonda pra 1)', () => {
    // quantity=1, grade_total=5 → 1/5 ficha. 196 × 0,2 = 39,2 cm (antes forçava 1 ficha=196).
    const cm = calculateStrapConsumptionCm(
      { consumption: 40, consumption_per_size: { '35': 38, '36': 40 } },
      { grade: { '35': 2, '36': 3 }, quantity: 1 },
    );
    expect(cm).toBeCloseTo(39.2, 4);
  });

  it('numeração sem consumo próprio cai no consumption default', () => {
    // 37 não tem per-size → usa default 40. totalPerFicha = 2×38 + 1×40 = 116.
    const cm = calculateStrapConsumptionCm(
      { consumption: 40, consumption_per_size: { '35': 38 } },
      { grade: { '35': 2, '37': 1 }, quantity: 3, fichas: 1 },
    );
    expect(cm).toBe(116);
  });

  it('grade com zeros é filtrada (só numerações com pares > 0)', () => {
    const cm = calculateStrapConsumptionCm(
      { consumption: 40, consumption_per_size: { '35': 38, '36': 40 } },
      { grade: { '35': 2, '36': 0 }, quantity: 2, fichas: 1 },
    );
    expect(cm).toBe(76); // só 35: 2×38
  });

  it('chave conjugada 33/34 casa grade 33 e 34', () => {
    const cm = calculateStrapConsumptionCm(
      { consumption: 40, consumption_per_size: { '33/34': 38 } },
      { grade: { '33': 2, '34': 2 }, quantity: 4, fichas: 1 },
    );
    expect(cm).toBe(152);
  });

  it('zero explícito no per-size não cai no consumption default', () => {
    const cm = calculateStrapConsumptionCm(
      { consumption: 40, consumption_per_size: { '35': 0, '36': 40 } },
      { grade: { '35': 2, '36': 1 }, quantity: 3, fichas: 1 },
    );
    expect(cm).toBe(40);
  });

  it('mapa per-size inteiramente zerado continua sendo explícito', () => {
    const cm = calculateStrapConsumptionCm(
      { consumption: 40, consumption_per_size: { '35': 0, '36': 0 } },
      { grade: { '35': 1, '36': 1 }, quantity: 2, fichas: 1 },
    );
    expect(cm).toBe(0);
  });
});

describe('calculateStrapConsumptionCm — valor por PAR (não por pé)', () => {
  it('o motor lê o storage CRU, sem ÷2/×2 (storage já é por PAR)', () => {
    // Se o valor salvo é 40 cm/PAR (= 20 cm/pé na UI), o motor usa 40, não 20 nem 80.
    const cm = calculateStrapConsumptionCm({ consumption: 40 }, { quantity: 1 });
    expect(cm).toBe(40);
  });
});

describe('resolveOrderStraps — merge item × ficha', () => {
  it('snapshot canônico conserva material, ordem e zero sem injetar a ficha atual', () => {
    const id = '0198f35c-7f4d-7000-8000-000000000001';
    const snapshot = [{ id, label: 'Posição antiga', color: 'Preto', consumption: 0,
      base_group_id: 'material-a', base_group_name: 'NAPA SOFT + MASSABOX' }];
    const merged = resolveOrderStraps(snapshot, [
      { id, label: 'Posição renomeada', consumption: 60, base_group_id: 'material-b' },
      { id: '0198f35c-7f4d-7000-8000-000000000002', label: 'Nova posição', consumption: 40 },
    ]);
    expect(merged).toEqual(snapshot);
    expect(calculateStrapConsumptionCm(merged[0], { quantity: 12 })).toBe(0);
  });

  it('item sobrescreve ficha quando casa por id+label', () => {
    const merged = resolveOrderStraps(
      [{ id: 1, label: 'Tira 1', color: 'Preto', consumption: 50 }],
      [{ id: 1, label: 'Tira 1', color: 'Branco', consumption: 40, group_name: 'TIRA A' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].color).toBe('Preto'); // cor do item vence
    expect(merged[0].consumption).toBe(50); // consumo do item (>0) vence
    expect(merged[0].group_name).toBe('TIRA A'); // grupo herda da ficha
  });

  it('consumo do item só vence se > 0; senão herda da ficha', () => {
    const merged = resolveOrderStraps(
      [{ id: 1, label: 'Tira 1', color: 'Preto', consumption: 0 }],
      [{ id: 1, label: 'Tira 1', color: 'Branco', consumption: 40 }],
    );
    expect(merged[0].consumption).toBe(40); // ficha (item era 0)
  });

  it('per-size do item vence mesmo quando todos os valores explícitos são zero', () => {
    const merged = resolveOrderStraps(
      [{ id: 1, label: 'T', color: 'X', consumption_per_size: { '35': 0 } }],
      [{ id: 1, label: 'T', color: 'X', consumption_per_size: { '35': 38 } }],
    );
    expect(merged[0].consumption_per_size).toEqual({ '35': 0 });
  });

  it('tira só na ficha entra; tira extra só no item também entra (dedup por chave)', () => {
    const merged = resolveOrderStraps(
      [
        { id: 1, label: 'Tira 1', color: 'Preto' },
        { id: 2, label: 'Tira 2', color: 'Azul' }, // extra só no item
      ],
      [{ id: 1, label: 'Tira 1', color: 'Branco' }],
    );
    expect(merged).toHaveLength(2);
    const labels = merged.map((m) => m.label).sort();
    expect(labels).toEqual(['Tira 1', 'Tira 2']);
  });

  it('listas vazias → []', () => {
    expect(resolveOrderStraps([], [])).toHaveLength(0);
    expect(resolveOrderStraps()).toHaveLength(0);
  });
});

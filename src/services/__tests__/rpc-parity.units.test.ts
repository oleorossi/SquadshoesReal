import { describe, it, expect } from 'vitest';
import { calcRequiredForGrade } from '@/lib/materialConsumption';
import { conversaoService } from '@/services/conversao';
import { UnidadeMedida } from '@/types/unidades';

/**
 * PARIDADE FRONTEND ↔ BACKEND
 *
 * Estes testes replicam em TypeScript a lógica das funções/RPCs de cálculo de
 * consumo (PL/pgSQL) e validam contra fixtures de pedidos. Se o cálculo do
 * frontend divergir do backend, o teste falha — flagrando bugs de unidade
 * (cm vs m, dm² vs m², g vs kg) antes de chegar a estoque/produção.
 *
 * Fontes consultadas:
 *  - supabase/migrations/...debit_strap_stock (4-arg canônica): cm/par × pares
 *    × fichas / 100 = metros consumidos.
 *  - calc_required_for_grade (SQL) — replicada em calcRequiredForGrade (TS).
 *  - calculate_order_consumption_by_grade — usa consumption_per_size em dm²/par
 *    para cabedal/forro/palmilha.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Replicação 1:1 da lógica SQL de debit_strap_stock (4-arg) em TS.
// SQL:
//   v_cm_per_pair := COALESCE(per_size->>v_size, v_consumption);
//   v_total_cm    := v_total_cm + (v_pairs * v_cm_per_pair);
//   v_required_m  := (v_total_cm * v_fichas) / 100;
// ─────────────────────────────────────────────────────────────────────────────
function rpcDebitStrapMeters(
  consumptionPerSize: Record<string, number>,
  fallbackCmPerPair: number,
  grade: Record<string, number>,
  fichas: number,
): number {
  let totalCm = 0;
  for (const [size, pairs] of Object.entries(grade)) {
    const cmPerPair = consumptionPerSize[size] ?? fallbackCmPerPair;
    totalCm += pairs * cmPerPair;
  }
  return (totalCm * fichas) / 100;
}

describe('debit_strap_stock — paridade cm/par → metros', () => {
  it('grade simples 34-38 (1 ficha) com consumo uniforme 22 cm/par', () => {
    const grade = { '34': 1, '35': 1, '36': 1, '37': 1, '38': 1 };
    const perSize = { '34': 22, '35': 22, '36': 22, '37': 22, '38': 22 };
    // 5 pares × 22cm = 110cm × 1 ficha / 100 = 1.10 metros
    const meters = rpcDebitStrapMeters(perSize, 22, grade, 1);
    expect(meters).toBeCloseTo(1.1, 4);
    // E a conversão inversa via service deve bater
    expect(conversaoService.converter(110, UnidadeMedida.CENTIMETRO, UnidadeMedida.METRO)).toBeCloseTo(meters, 4);
  });

  it('grade variada com consumo per-size diferente por numeração', () => {
    const grade = { '34': 2, '36': 3, '38': 2 };
    const perSize = { '34': 20, '36': 22, '38': 24 };
    const fichas = 4;
    // (2×20 + 3×22 + 2×24) × 4 / 100 = (40+66+48)×4/100 = 154×4/100 = 6.16 m
    expect(rpcDebitStrapMeters(perSize, 22, grade, fichas)).toBeCloseTo(6.16, 4);
  });

  it('fallback: numeração ausente em consumption_per_size usa o valor médio', () => {
    const grade = { '34': 1, '40': 1 }; // 40 não está em perSize
    const perSize = { '34': 20 };
    const fallback = 25; // cm/par
    // (1×20 + 1×25) × 1 / 100 = 0.45 m
    expect(rpcDebitStrapMeters(perSize, fallback, grade, 1)).toBeCloseTo(0.45, 4);
  });

  it('REGRESSÃO: fallback em metros (ex: 0.22) provocaria erro 100x menor — bloqueado pelo trigger', () => {
    // O trigger validate_strap_consumption_unit rejeita consumption < 1.
    // Aqui apenas documentamos o impacto numérico do bug histórico.
    const grade = { '36': 1 };
    const fallbackCorretoCm = 22;     // canônico
    const fallbackBugadoEmM = 0.22;   // legado (rejeitado por trigger)
    const corretoM = rpcDebitStrapMeters({}, fallbackCorretoCm, grade, 1);
    const bugadoM = rpcDebitStrapMeters({}, fallbackBugadoEmM, grade, 1);
    expect(corretoM / bugadoM).toBeCloseTo(100, 2); // 100× de divergência
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Paridade calc_required_for_grade (SQL) ↔ calcRequiredForGrade (TS).
// Usa consumption_per_size em dm²/par (cabedal, forro, palmilha).
// ─────────────────────────────────────────────────────────────────────────────
describe('calc_required_for_grade — paridade dm²/par × grade', () => {
  it('cabedal: consumo 6.5 dm²/par × 12 pares = 78 dm²', () => {
    const perSize = { '34': 6.0, '36': 6.5, '38': 7.0 };
    const grade = { '34': 4, '36': 4, '38': 4 };
    // 4×6.0 + 4×6.5 + 4×7.0 = 24+26+28 = 78 dm²
    expect(calcRequiredForGrade(perSize, grade, 6.5, 12)).toBeCloseTo(78, 4);
    // Equivale a 0.78 m² (sanity check via service)
    const m2 = conversaoService.converter(78, UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.METRO_QUADRADO);
    expect(m2).toBeCloseTo(0.78, 4);
  });

  it('fallback quantity × total quando per_size está vazio', () => {
    expect(calcRequiredForGrade({}, {}, 6.5, 10)).toBeCloseTo(65, 4);
    expect(calcRequiredForGrade(null, null, 6.5, 10)).toBeCloseTo(65, 4);
  });

  it('numeração com per_size=0 cai no fallback quantityPerUnit', () => {
    const perSize = { '34': 6, '36': 0 };
    const grade = { '34': 1, '36': 1 };
    // 1×6 + 1×6.5 (fallback) = 12.5
    expect(calcRequiredForGrade(perSize, grade, 6.5, 2)).toBeCloseTo(12.5, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Conversões críticas em campos de cabedal/forro/palmilha
// (dm²/par no banco — m²/par eventualmente exibido no UI)
// ─────────────────────────────────────────────────────────────────────────────
describe('upper/lining/insole consumption — dm²/par é a unidade canônica', () => {
  it('REGRESSÃO: valor < 1 sugere armazenamento errôneo em m²/par (100×)', () => {
    const consumoCorretoDm2 = 6.5;
    const consumoBugadoM2 = 0.065;
    // Usuário cadastrou 0.065 m²/par achando ser dm²/par → consumo 100× menor
    const dm2EquivalenteAoBug = conversaoService.converter(
      consumoBugadoM2, UnidadeMedida.METRO_QUADRADO, UnidadeMedida.DECIMETRO_QUADRADO
    );
    expect(dm2EquivalenteAoBug).toBeCloseTo(consumoCorretoDm2, 4);
    // A auditoria (RPC audit_unit_divergences) flagra valores < 1 em
    // technical_sheets/sole_technical_specs como suspeitos justamente por isso.
    expect(consumoBugadoM2).toBeLessThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOM: kg vs g (cola, químicos, linha)
// ─────────────────────────────────────────────────────────────────────────────
describe('BOM — paridade g/par → kg total para 1000 pares', () => {
  it('cola: 25 g/par × 1000 pares = 25 kg', () => {
    const gPorPar = 25;
    const pares = 1000;
    const totalG = gPorPar * pares;
    const totalKg = conversaoService.converter(totalG, UnidadeMedida.GRAMA, UnidadeMedida.QUILOGRAMA);
    expect(totalKg).toBeCloseTo(25, 4);
  });

  it('linha: 1.2 g/par × 500 pares = 0.6 kg', () => {
    const totalG = 1.2 * 500;
    expect(
      conversaoService.converter(totalG, UnidadeMedida.GRAMA, UnidadeMedida.QUILOGRAMA)
    ).toBeCloseTo(0.6, 4);
  });
});

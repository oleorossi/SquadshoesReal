import { describe, it, expect } from 'vitest';
import { SECTOR_CONFIG, getEffectiveCapacityPerDay } from '../leadTime';
import { DEFAULT_LEAD_TIME_COLUMNS } from '../sectorCapacity';

/**
 * GUARD DE CONTRATO — colunas do fetch de `default_lead_times`.
 *
 * `fetchCategoryDefaultsMap` seleciona exatamente `DEFAULT_LEAD_TIME_COLUMNS`.
 * Toda coluna que o motor (`leadTime.ts`) lê da linha da categoria PRECISA estar
 * nessa lista — senão o Supabase simplesmente não devolve o campo, o valor chega
 * `undefined`, o TS loose não acusa e a capacidade cai silenciosamente no
 * fallback legado. A tela diverge do motor de ondas sem nenhum erro.
 *
 * Foi exatamente o que aconteceu em 2026-08-03: a Costura virou dois setores
 * (`costura_cabedal_capacity_per_day` / `costura_palmilha_capacity_per_day`,
 * migs 20261001120000 e 20261015120000), o SQL passou a ler as duas colunas e o
 * `DEFAULT_LEAD_TIME_COLUMNS` não foi atualizado. Resultado: `compute_wave_timeline`
 * usava 600 pares/dia na Rasteirinha enquanto o Gargalo Diário usava 550.
 *
 * O guard é AUTO-DERIVADO do `SECTOR_CONFIG`: setor novo ou troca de coluna
 * entram na cobertura sem ninguém lembrar de editar este arquivo.
 */
describe('DEFAULT_LEAD_TIME_COLUMNS × SECTOR_CONFIG', () => {
  const selected = new Set(
    DEFAULT_LEAD_TIME_COLUMNS.split(',').map((c) => c.trim()).filter(Boolean),
  );

  it('seleciona toda coluna de capacidade que o motor lê da categoria', () => {
    const missing: string[] = [];
    for (const [sector, cfg] of Object.entries(SECTOR_CONFIG)) {
      for (const field of [cfg.capField, cfg.fallbackCapField]) {
        if (field && !selected.has(field as string)) missing.push(`${sector} → ${String(field)}`);
      }
    }
    expect(
      missing,
      `colunas de capacidade lidas pelo SECTOR_CONFIG mas AUSENTES de DEFAULT_LEAD_TIME_COLUMNS: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('seleciona toda coluna de lead time legado usada no fallback', () => {
    const missing: string[] = [];
    for (const [sector, cfg] of Object.entries(SECTOR_CONFIG)) {
      if (!selected.has(cfg.ltField as string)) missing.push(`${sector} → ${String(cfg.ltField)}`);
    }
    expect(
      missing,
      `colunas de lead time lidas pelo SECTOR_CONFIG mas AUSENTES de DEFAULT_LEAD_TIME_COLUMNS: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('a costura dividida usa a coluna do próprio setor, não o legado', () => {
    // Linha real da Rasteirinha (03/08/2026): legado 550, split 600.
    const categoria = {
      costura_capacity_per_day: 550,
      costura_cabedal_capacity_per_day: 600,
      costura_palmilha_capacity_per_day: 600,
    };
    expect(getEffectiveCapacityPerDay('costura_cabedal', null, categoria)).toBe(600);
    expect(getEffectiveCapacityPerDay('costura_palmilha', null, categoria)).toBe(600);
    // Sem os campos novos, cai no legado — não-regressão de categoria antiga.
    expect(
      getEffectiveCapacityPerDay('costura_cabedal', null, { costura_capacity_per_day: 550 }),
    ).toBe(550);
  });
});

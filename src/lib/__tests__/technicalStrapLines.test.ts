import { describe, expect, it } from 'vitest';
import {
  applyCanonicalTechnicalStrapMeasure,
  applyTechnicalStrapColorMode,
  applyTechnicalStrapIdentity,
  ensureTechnicalStrapLineIds,
  hasCanonicalTechnicalStrapIdentity,
  isUuid,
  strapColorMode,
  technicalStrapLineId,
} from '@/lib/technicalStrapLines';

describe('technicalStrapLines', () => {
  it('migra ids ordinais para UUIDs estáveis', () => {
    const [line] = ensureTechnicalStrapLineIds([{ id: '1', label: 'TIRA 1' }]);
    expect(isUuid(line.technical_strap_line_id)).toBe(true);
    expect(line.id).toBe(line.technical_strap_line_id);
    expect(line.identity_basis).toBe('reference_base');
    expect(line.identity_group_id).toBeNull();
    expect(line.color_mode).toBe('follow_main');
  });

  it('preserva UUID e política de cor já atribuídos', () => {
    const id = crypto.randomUUID();
    const [line] = ensureTechnicalStrapLineIds([{
      id,
      technical_strap_line_id: id,
      color_mode: 'select_on_order' as const,
    }]);
    expect(line.id).toBe(id);
    expect(technicalStrapLineId(line)).toBe(id);
    expect(line.color_mode).toBe('select_on_order');
  });

  it('preserva UUID canônico aceito pelo Postgres independentemente da versão', () => {
    const uuidV7 = '0198f35c-7f4d-7000-8000-000000000001';
    const [line] = ensureTechnicalStrapLineIds([{
      id: uuidV7,
      technical_strap_line_id: uuidV7,
    }]);

    expect(isUuid(uuidV7)).toBe(true);
    expect(line.id).toBe(uuidV7);
    expect(technicalStrapLineId(line)).toBe(uuidV7);
  });

  it('gera identidades novas e preserva a política ao clonar uma ficha', () => {
    const id = crypto.randomUUID();
    const [clone] = ensureTechnicalStrapLineIds([{
      id,
      technical_strap_line_id: id,
      color_mode: 'select_on_order' as const,
    }], true);
    expect(clone.id).not.toBe(id);
    expect(isUuid(clone.technical_strap_line_id)).toBe(true);
    expect(clone.color_mode).toBe('select_on_order');
  });

  it('normaliza a política legada conforme a base da identidade', () => {
    expect(strapColorMode({ identity_basis: 'reference_base' })).toBe('follow_main');
    expect(strapColorMode({
      identity_basis: 'finished_product_group',
      color_mode: 'follow_main',
    })).toBe('select_on_order');

    const [readyLine] = ensureTechnicalStrapLineIds([{
      identity_basis: 'finished_product_group' as const,
      color_mode: 'follow_main' as const,
    }]);
    expect(readyLine.color_mode).toBe('select_on_order');
  });

  it('altera somente a política de cor, sem regenerar a identidade técnica', () => {
    const id = crypto.randomUUID();
    const selected = applyTechnicalStrapColorMode({
      id,
      technical_strap_line_id: id,
      identity_basis: 'reference_base',
      color_mode: 'follow_main',
    }, 'select_on_order');

    expect(selected.technical_strap_line_id).toBe(id);
    expect(selected.id).toBe(id);
    expect(selected.color_mode).toBe('select_on_order');
  });

  it('grava família e medida canônicas juntas e rejeita identidade divergente', () => {
    const technicalLineId = crypto.randomUUID();
    const measure = {
      id: crypto.randomUUID(),
      strap_type_id: crypto.randomUUID(),
      active: true,
    };
    const type = { id: measure.strap_type_id, active: true };
    const selected = applyCanonicalTechnicalStrapMeasure({
      technical_strap_line_id: technicalLineId,
      group_id: 'legado-apenas-rotulo',
    }, measure);

    expect(selected).toMatchObject({
      technical_strap_line_id: technicalLineId,
      measure_id: measure.id,
      strap_type_id: measure.strap_type_id,
      group_id: 'legado-apenas-rotulo',
    });
    expect(hasCanonicalTechnicalStrapIdentity(selected, [measure], [type])).toBe(true);
    expect(hasCanonicalTechnicalStrapIdentity(
      { ...selected, strap_type_id: crypto.randomUUID() },
      [measure],
      [type],
    )).toBe(false);
    expect(hasCanonicalTechnicalStrapIdentity(selected, [measure], [{ ...type, active: false }])).toBe(false);
  });

  it('exige grupo estrutural na identidade de produto acabado', () => {
    const technicalLineId = crypto.randomUUID();
    const measure = {
      id: crypto.randomUUID(),
      strap_type_id: crypto.randomUUID(),
      active: true,
    };
    const type = { id: measure.strap_type_id, active: true };
    const base = applyCanonicalTechnicalStrapMeasure({
      technical_strap_line_id: technicalLineId,
    }, measure);

    const missingGroup = applyTechnicalStrapIdentity(base, 'finished_product_group');
    expect(hasCanonicalTechnicalStrapIdentity(missingGroup, [measure], [type])).toBe(false);

    const withGroup = applyTechnicalStrapIdentity(
      base,
      'finished_product_group',
      crypto.randomUUID(),
    );
    expect(hasCanonicalTechnicalStrapIdentity(withGroup, [measure], [type])).toBe(true);
    expect(withGroup.color_mode).toBe('select_on_order');
  });
});

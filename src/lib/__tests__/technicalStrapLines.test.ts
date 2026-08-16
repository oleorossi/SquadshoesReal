import { describe, expect, it } from 'vitest';
import {
  applyCanonicalTechnicalStrapMeasure,
  applyTechnicalStrapIdentity,
  ensureTechnicalStrapLineIds,
  hasCanonicalTechnicalStrapIdentity,
  isUuid,
  technicalStrapLineId,
} from '@/lib/technicalStrapLines';

describe('technicalStrapLines', () => {
  it('migra ids ordinais para UUIDs estáveis', () => {
    const [line] = ensureTechnicalStrapLineIds([{ id: '1', label: 'TIRA 1' }]);
    expect(isUuid(line.technical_strap_line_id)).toBe(true);
    expect(line.id).toBe(line.technical_strap_line_id);
    expect(line.identity_basis).toBe('reference_base');
    expect(line.identity_group_id).toBeNull();
  });

  it('preserva um UUID já atribuído', () => {
    const id = crypto.randomUUID();
    const [line] = ensureTechnicalStrapLineIds([{ id, technical_strap_line_id: id }]);
    expect(line.id).toBe(id);
    expect(technicalStrapLineId(line)).toBe(id);
  });

  it('gera identidades novas ao clonar uma ficha', () => {
    const id = crypto.randomUUID();
    const [clone] = ensureTechnicalStrapLineIds([{ id, technical_strap_line_id: id }], true);
    expect(clone.id).not.toBe(id);
    expect(isUuid(clone.technical_strap_line_id)).toBe(true);
  });

  it('grava família e medida canônicas juntas e rejeita identidade divergente', () => {
    const technicalLineId = crypto.randomUUID();
    const measure = {
      id: crypto.randomUUID(),
      strap_type_id: crypto.randomUUID(),
      active: true,
    };
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
    expect(hasCanonicalTechnicalStrapIdentity(selected, [measure])).toBe(true);
    expect(hasCanonicalTechnicalStrapIdentity(
      { ...selected, strap_type_id: crypto.randomUUID() },
      [measure],
    )).toBe(false);
  });

  it('exige grupo estrutural na identidade de produto acabado', () => {
    const technicalLineId = crypto.randomUUID();
    const measure = {
      id: crypto.randomUUID(),
      strap_type_id: crypto.randomUUID(),
      active: true,
    };
    const base = applyCanonicalTechnicalStrapMeasure({
      technical_strap_line_id: technicalLineId,
    }, measure);

    const missingGroup = applyTechnicalStrapIdentity(base, 'finished_product_group');
    expect(hasCanonicalTechnicalStrapIdentity(missingGroup, [measure])).toBe(false);

    const withGroup = applyTechnicalStrapIdentity(
      base,
      'finished_product_group',
      crypto.randomUUID(),
    );
    expect(hasCanonicalTechnicalStrapIdentity(withGroup, [measure])).toBe(true);
  });
});

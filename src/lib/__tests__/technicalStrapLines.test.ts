import { describe, expect, it } from 'vitest';
import {
  applyCanonicalTechnicalStrapMeasure,
  applyTechnicalStrapColorMode,
  applyTechnicalStrapIdentity,
  ensureTechnicalStrapLineIds,
  hasCanonicalTechnicalStrapIdentity,
  isUuid,
  replicateFirstTechnicalStrapType,
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

  it('replica o tipo sem perder a identidade, cor ou consumo próprios de cada tira', () => {
    const lines = [0, 1, 2].map((index) => {
      const id = crypto.randomUUID();
      return {
        id,
        technical_strap_line_id: id,
        label: index === 2 ? 'TRASEIRA' : `TIRA ${index + 1}`,
        strap_type_id: crypto.randomUUID(),
        measure_id: crypto.randomUUID(),
        identity_basis: 'reference_base' as const,
        identity_group_id: null,
        color_mode: index === 0 ? 'select_on_order' as const : 'follow_main' as const,
        color: ['PRETO', 'OFF WHITE', 'WHISKY'][index],
        color_id: crypto.randomUUID(),
        consumption: 30 + index * 10,
        consumption_per_size: { '33/34': 28 + index * 10, '35/36': 32 + index * 10 },
        group_id: `grupo-legado-${index}`,
        group_name: `Rótulo legado ${index}`,
      };
    });
    const before = structuredClone(lines);
    lines.forEach((line) => {
      Object.freeze(line.consumption_per_size);
      Object.freeze(line);
    });
    Object.freeze(lines);

    const replicated = replicateFirstTechnicalStrapType(lines);

    expect(replicated[0]).toBe(lines[0]);
    expect(lines).toEqual(before);
    expect(new Set(replicated.map(line => line.technical_strap_line_id)).size).toBe(3);
    replicated.slice(1).forEach((line, index) => {
      expect(line).toEqual({
        ...before[index + 1],
        strap_type_id: before[0].strap_type_id,
        measure_id: before[0].measure_id,
        color_mode: 'select_on_order',
        material_mode: 'follow_reference',
        material_group_id: null,
        allowed_material_group_ids: [],
        base_group_id: null,
        base_group_name: null,
      });
    });
  });

  it('replica grupo comprado pronto com seleção de cor no pedido', () => {
    const groupId = crypto.randomUUID();
    const lines = [
      {
        identity_basis: 'finished_product_group' as const,
        identity_group_id: groupId,
        color_mode: 'follow_main' as const,
        strap_type_id: crypto.randomUUID(),
        measure_id: crypto.randomUUID(),
      },
      {
        identity_basis: 'reference_base' as const,
        identity_group_id: null,
        color_mode: 'follow_main' as const,
      },
    ];

    const [first, copied] = replicateFirstTechnicalStrapType(lines);

    expect(first).toBe(lines[0]);
    expect(copied).toMatchObject({
      identity_basis: 'finished_product_group',
      identity_group_id: groupId,
      color_mode: 'select_on_order',
    });
  });

  it('ao voltar à napa da referência remove o grupo acabado e herda a política legada', () => {
    const lines = [
      {
        strap_type_id: crypto.randomUUID(),
        measure_id: crypto.randomUUID(),
        // Identidade/política ausentes no JSON legado seguem a referência.
        identity_group_id: crypto.randomUUID(),
      },
      {
        identity_basis: 'finished_product_group' as const,
        identity_group_id: crypto.randomUUID(),
        color_mode: 'select_on_order' as const,
      },
    ];

    const [first, copied] = replicateFirstTechnicalStrapType(lines);

    expect(first).toBe(lines[0]);
    expect(copied).toMatchObject({
      identity_basis: 'reference_base',
      identity_group_id: null,
      color_mode: 'follow_main',
    });
  });

  it.each(['fixed_group', 'select_on_order'] as const)('replica política de material %s preservando UUID e consumo', mode => {
    const groupId = crypto.randomUUID();
    const [first, second] = ensureTechnicalStrapLineIds([
      {
        material_mode: mode,
        material_group_id: mode === 'fixed_group' ? groupId : null,
        allowed_material_group_ids: mode === 'select_on_order' ? [groupId] : [],
        consumption: 40, consumption_per_size: { '34': 40 },
      },
      { consumption: 60, consumption_per_size: { '34': 60 } },
    ]);
    const [, copied] = replicateFirstTechnicalStrapType([first, second]);
    expect(copied).toMatchObject({
      technical_strap_line_id: second.technical_strap_line_id,
      material_mode: mode, material_group_id: first.material_group_id,
      allowed_material_group_ids: first.allowed_material_group_ids,
      consumption: 60, consumption_per_size: { '34': 60 },
    });
    expect(copied.allowed_material_group_ids).not.toBe(first.allowed_material_group_ids);
  });

  it('não replica política de material explícita desconhecida', () => {
    const lines = [{ material_mode: 'future_mode' }, { material_mode: 'follow_reference' }];
    expect(replicateFirstTechnicalStrapType(lines)).toBe(lines);
    const [hydrated] = ensureTechnicalStrapLineIds(lines);
    expect(hydrated.material_mode).toBe('future_mode');
  });

  it('a escolha explícita de compra pronta remove política e snapshot da matéria-prima', () => {
    const ready = applyTechnicalStrapIdentity({
      material_mode: 'fixed_group', material_group_id: crypto.randomUUID(),
      base_group_id: crypto.randomUUID(), base_group_name: 'NAPA SOFT + MASSABOX', consumption: 42,
    }, 'finished_product_group', crypto.randomUUID());
    expect(ready).toMatchObject({
      material_mode: 'follow_reference', material_group_id: null, allowed_material_group_ids: [],
      base_group_id: null, base_group_name: null, consumption: 42,
    });
  });

  it('mantém fichas sem tiras ou com apenas uma tira intactas', () => {
    expect(replicateFirstTechnicalStrapType([])).toEqual([]);
    const onlyLine = [{ id: crypto.randomUUID(), measure_id: null }];
    const before = structuredClone(onlyLine);

    expect(replicateFirstTechnicalStrapType(onlyLine)).toEqual(before);
    expect(onlyLine).toEqual(before);
  });
});

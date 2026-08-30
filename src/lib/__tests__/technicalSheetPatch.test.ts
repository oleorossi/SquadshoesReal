import { describe, expect, it } from 'vitest';
import {
  buildTechnicalSheetPatch,
  cloneTechnicalSheetSnapshot,
  replaceTechnicalSheetCacheRow,
  technicalSheetValuesEqual,
} from '@/lib/technicalSheetPatch';

describe('buildTechnicalSheetPatch', () => {
  it('não envia mutation fields quando o formulário voltou ao valor persistido', () => {
    const persisted = {
      name: 'I90',
      description: 'Sandália infantil',
      upper_consumption_per_size: { 34: 8.5, 35: 8.7 },
      strap_colors: [{ id: 'linha-1', sizes: ['34', '35'] }],
    };
    const next = {
      ...persisted,
      upper_consumption_per_size: { 35: 8.7, 34: 8.5 },
      strap_colors: [{ id: 'linha-1', sizes: ['34', '35'] }],
    };

    expect(buildTechnicalSheetPatch(persisted, next)).toEqual({});
  });

  it('envia somente a coluna de topo cujo conteúdo profundo mudou', () => {
    const persisted = {
      name: 'I90',
      description: 'Original',
      upper_consumption_per_size: { 34: 8.5, 35: 8.7 },
    };
    const next = {
      ...persisted,
      upper_consumption_per_size: { 34: 8.5, 35: 9.1 },
    };

    expect(buildTechnicalSheetPatch(persisted, next)).toEqual({
      upper_consumption_per_size: { 34: 8.5, 35: 9.1 },
    });
  });

  it('não inclui name nem campos de escrita exclusiva quando não mudaram', () => {
    const persisted = {
      name: 'I90',
      description: 'Original',
      cutting_capacity_per_day: 300,
      sewing_capacity_per_day: 250,
      assembly_capacity_per_day: 400,
      production_sectors: ['Corte'],
      aviamento_steps: ['Separar'],
    };
    const next = {
      ...persisted,
      description: 'Corrigida',
      production_sectors: ['Corte', 'Montagem'],
      aviamento_steps: ['Separar', 'Cortar'],
    };

    const patch = buildTechnicalSheetPatch(
      persisted,
      next,
      ['production_sectors', 'aviamento_steps'],
    );

    expect(patch).toEqual({ description: 'Corrigida' });
    expect(patch).not.toHaveProperty('name');
    expect(patch).not.toHaveProperty('cutting_capacity_per_day');
    expect(patch).not.toHaveProperty('sewing_capacity_per_day');
    expect(patch).not.toHaveProperty('assembly_capacity_per_day');
  });

  it('preserva clears explícitos em vez de descartá-los como ausência de mudança', () => {
    const persisted = {
      description: 'Texto',
      upper_material_group_id: 'grupo-1',
      sale_price: 89.9,
      has_straps: true,
      strap_colors: [{ id: 'linha-1' }],
    };

    expect(buildTechnicalSheetPatch(persisted, {
      description: '',
      upper_material_group_id: null,
      sale_price: 0,
      has_straps: false,
      strap_colors: [],
    })).toEqual({
      description: '',
      upper_material_group_id: null,
      sale_price: 0,
      has_straps: false,
      strap_colors: [],
    });
  });
});

describe('technicalSheetValuesEqual', () => {
  it('preserva a ordem semântica de arrays', () => {
    expect(technicalSheetValuesEqual(['34', '35'], ['35', '34'])).toBe(false);
  });
});

describe('cloneTechnicalSheetSnapshot', () => {
  it('mantém o baseline isolado de mutações aninhadas do formulário', () => {
    const form = { components: [{ quantity: 1 }] };
    const snapshot = cloneTechnicalSheetSnapshot(form);
    form.components[0].quantity = 2;

    expect(snapshot.components[0].quantity).toBe(1);
  });
});

describe('replaceTechnicalSheetCacheRow', () => {
  it('substitui apenas a ficha salva, sem duplicá-la, e a move para o topo', () => {
    const cached = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B antiga' },
      { id: 'c', name: 'C' },
    ];

    expect(replaceTechnicalSheetCacheRow(cached, { id: 'b', name: 'B nova' })).toEqual([
      { id: 'b', name: 'B nova' },
      { id: 'a', name: 'A' },
      { id: 'c', name: 'C' },
    ]);
  });
});

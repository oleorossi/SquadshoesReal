import { describe, expect, it } from 'vitest';
import { dominantRole, floorPrimaryItems, isFloorOperator } from '@/lib/floorChrome';

describe('dominantRole', () => {
  it('admin vence producao', () => {
    expect(dominantRole(['producao', 'admin'])).toBe('admin');
  });
  it('producao vence almoxarifado', () => {
    expect(dominantRole(['almoxarifado', 'producao'])).toBe('producao');
  });
});

describe('isFloorOperator', () => {
  it('producao puro é chão', () => {
    expect(isFloorOperator(['producao'])).toBe(true);
  });
  it('admin+producao NÃO é chão', () => {
    expect(isFloorOperator(['admin', 'producao'])).toBe(false);
  });
  it('almoxarifado é chão', () => {
    expect(isFloorOperator(['almoxarifado'])).toBe(true);
  });
});

describe('floorPrimaryItems', () => {
  it('apontador: Apontar / Kanban / Estoque / Separar', () => {
    expect(floorPrimaryItems(['producao'])?.map((i) => i.path)).toEqual([
      '/producao/apontamento',
      '/producao/kanban',
      '/estoque',
      '/picking',
    ]);
  });
  it('admin não troca o nav', () => {
    expect(floorPrimaryItems(['admin'])).toBeNull();
  });
  it('almoxarife: Estoque / Separar / Saída / Kanban', () => {
    expect(floorPrimaryItems(['almoxarifado'])?.map((i) => i.key)).toEqual([
      'estoque', 'separar', 'conferencia', 'kanban',
    ]);
  });
});

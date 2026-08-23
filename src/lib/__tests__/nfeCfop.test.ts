import { describe, expect, it } from 'vitest';
import {
  assertNfeCfopColumns,
  classifyNfeItemOrigin,
  resolveHeaderNfeCfop,
  resolveNfeCfop,
} from '../../../supabase/functions/_shared/nfeCfop';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fiscal = {
  cfop: '5101',
  cfop_industrial_interno: '5101',
  cfop_industrial_externo: '6101',
  cfop_revenda_interno: '5102',
  cfop_revenda_externo: '6102',
};

describe('resolveNfeCfop — indústria de calçados', () => {
  it('ficha técnica intraestadual usa 5101 (produção própria)', () => {
    expect(resolveNfeCfop({ isInterstate: false, kind: 'industrial', fiscal })).toEqual({
      cfop: '5101', kind: 'industrial',
    });
  });

  it('ficha técnica interestadual usa 6101, não o flip cego do cfop legado', () => {
    expect(resolveNfeCfop({
      isInterstate: true,
      kind: 'industrial',
      fiscal: { ...fiscal, cfop: '5101', cfop_industrial_externo: '6101' },
    })).toEqual({ cfop: '6101', kind: 'industrial' });
  });

  it('item avulso (revenda) usa 5102/6102', () => {
    expect(resolveNfeCfop({ isInterstate: false, kind: 'revenda', fiscal }).cfop).toBe('5102');
    expect(resolveNfeCfop({ isInterstate: true, kind: 'revenda', fiscal }).cfop).toBe('6102');
  });

  it('sem colunas industriais cai no cfop legado 5101 e flipa a UF', () => {
    expect(resolveNfeCfop({
      isInterstate: true,
      kind: 'industrial',
      fiscal: { cfop: '5101' },
    }).cfop).toBe('6101');
  });

  it('classifica ficha como indústria e produto avulso como revenda', () => {
    expect(classifyNfeItemOrigin({ technical_sheets: { id: 's1' }, reference_id: 's1' })).toBe('industrial');
    expect(classifyNfeItemOrigin({ reference_id: 's1' })).toBe('industrial');
    expect(classifyNfeItemOrigin({ products: { id: 'p1' } })).toBe('revenda');
  });

  it('cabeçalho privilegia indústria quando a nota mistura origens', () => {
    const header = resolveHeaderNfeCfop([
      { cfop: '5102', kind: 'revenda' },
      { cfop: '5101', kind: 'industrial' },
    ]);
    expect(header).toEqual({ cfop: '5101', kind: 'industrial' });
  });

  it('recusa CFOP com formato inválido no cadastro', () => {
    expect(() => assertNfeCfopColumns({ cfop_industrial_interno: '51' }))
      .toThrow(/CFOP configurado inválido/);
  });
});

describe('emit-nfe — contrato da indústria', () => {
  const source = readFileSync(resolve('supabase/functions/emit-nfe/index.ts'), 'utf8');

  it('grava Pedido de Venda com order_number (não numero_pv, que não existe)', () => {
    expect(source).toContain('order.order_number');
    expect(source).toContain('Pedido de Venda:');
    expect(source).not.toMatch(/order\.numero_pv/);
  });

  it('escolhe CFOP industrial/revenda pelo helper compartilhado', () => {
    expect(source).toContain('resolveNfeCfop');
    expect(source).toContain('classifyNfeItemOrigin');
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyLotFace,
  brandingFieldsForPattern,
  faceFieldsForPattern,
  isLotBrandingDirty,
  isLotFaceDirty,
  mergeLotBranding,
  pontoMixLineOverrideFromFace,
  seedLotBranding,
  seedLotFaceFromRow,
  seedLotFaceFromRows,
  validateLotFace,
} from '@/lib/clientLabelLotTexts';
import {
  OBJETIVA_DEFAULT_BRANDING,
  clientOrderLineSkuKey,
  type ClientOrderLine,
} from '@/lib/clientLabelPattern';
import { composePontoMixLabelCopy } from '@/lib/pontoMixLabels';

function sampleRow(overrides: Partial<ClientOrderLine> = {}): ClientOrderLine {
  return {
    tamanho: '34',
    cor: 'PRETO',
    referencia: 'SP201',
    codProduto: '105742',
    codigoBarra: '105742',
    quantidade: 2,
    descricao: 'SANDALIA CALCADOS FEM',
    valor: '39.99',
    tipo: 'SANDALIA',
    grupo: 'CALCADOS',
    categoria: 'FEM',
    ...overrides,
  };
}

describe('clientLabelLotTexts', () => {
  it('branding fields depend on the active pattern', () => {
    expect(brandingFieldsForPattern('objetiva').map(f => f.key)).toEqual([
      'motto',
      'exchangeText',
      'materialPrefix',
    ]);
    expect(brandingFieldsForPattern('nalin_tag').map(f => f.key)).toEqual(['exchangeText']);
    expect(brandingFieldsForPattern('ponto_mix')).toEqual([]);
    expect(brandingFieldsForPattern('objetiva_adesiva')).toEqual([]);
  });

  it('face fields are dynamic per pattern and never include barcode', () => {
    const objetiva = faceFieldsForPattern('objetiva').map(f => f.key);
    expect(objetiva).toContain('descricao');
    expect(objetiva).toContain('referencia');
    expect(objetiva).not.toContain('codigoBarra' as never);

    const ponto = faceFieldsForPattern('ponto_mix').map(f => f.key);
    expect(ponto).toEqual(['line1', 'line2', 'line3', 'tamanho', 'valor']);
  });

  it('seed + apply preserve codigoBarra and override face text', () => {
    const row = sampleRow();
    const seeded = seedLotFaceFromRow(row, 'objetiva');
    expect(seeded.descricao).toBe('SANDALIA CALCADOS FEM');
    expect(seeded.cor).toBe('PRETO');

    const applied = applyLotFace(
      row,
      { ...seeded, descricao: 'SANDALIA EDITADA', cor: 'OFF WHITE' },
      'objetiva',
    );
    expect(applied.descricao).toBe('SANDALIA EDITADA');
    expect(applied.cor).toBe('OFF WHITE');
    expect(applied.codigoBarra).toBe('105742');
    expect(clientOrderLineSkuKey(row)).not.toBe(clientOrderLineSkuKey(applied));
  });

  it('validateLotFace blocks empty identity and price cleared when CSV had price', () => {
    const row = sampleRow();
    const skuKey = clientOrderLineSkuKey(row);
    const issues = validateLotFace(
      [{ row, skuKey }],
      {
        [skuKey]: {
          ...seedLotFaceFromRow(row, 'objetiva'),
          referencia: '',
          valor: '',
        },
      },
      'objetiva',
    );
    expect(issues.some(i => i.field === 'referencia')).toBe(true);
    expect(issues.some(i => i.field === 'valor')).toBe(true);
  });

  it('validateLotFace allows empty branding-driven fields and empty price if CSV had none', () => {
    const row = sampleRow({ valor: undefined });
    const skuKey = clientOrderLineSkuKey(row);
    const issues = validateLotFace(
      [{ row, skuKey }],
      { [skuKey]: seedLotFaceFromRow(row, 'objetiva_adesiva') },
      'objetiva_adesiva',
    );
    expect(issues).toEqual([]);
  });

  it('Ponto Mix seeds assembled lines and line override bypasses template', () => {
    const row = sampleRow({
      descricao: 'SANDALIA CALCADOS  FEM SQUARD SHOES SP201 PRETO 34  34',
    });
    const seeded = seedLotFaceFromRow(row, 'ponto_mix');
    expect(seeded.line1).toBeTruthy();
    expect(seeded.line2).toBeTruthy();

    const override = pontoMixLineOverrideFromFace({
      ...seeded,
      line1: 'LINHA CUSTOM 1',
      line2: 'LINHA CUSTOM 2',
      line3: 'LINHA CUSTOM 3',
    });
    const copy = composePontoMixLabelCopy(row, undefined, undefined, override);
    expect(copy.line1).toBe('LINHA CUSTOM 1');
    expect(copy.line2).toBe('LINHA CUSTOM 2');
    expect(copy.line3).toBe('LINHA CUSTOM 3');
  });

  it('dirty helpers detect branding and face edits', () => {
    const row = sampleRow();
    const lot = seedLotBranding(OBJETIVA_DEFAULT_BRANDING);
    expect(isLotBrandingDirty(OBJETIVA_DEFAULT_BRANDING, lot, 'objetiva')).toBe(false);
    expect(
      isLotBrandingDirty(OBJETIVA_DEFAULT_BRANDING, { ...lot, motto: 'OUTRO' }, 'objetiva'),
    ).toBe(true);

    const face = seedLotFaceFromRow(row, 'objetiva');
    expect(isLotFaceDirty(row, face, 'objetiva')).toBe(false);
    expect(isLotFaceDirty(row, { ...face, descricao: 'X' }, 'objetiva')).toBe(true);
  });

  it('mergeLotBranding keeps logo from pattern and texts from lote', () => {
    const merged = mergeLotBranding(
      { ...OBJETIVA_DEFAULT_BRANDING, logoUrl: 'path/logo.png' },
      { motto: '', exchangeText: 'TROCA', materialPrefix: 'PVC' },
    );
    expect(merged.logoUrl).toBe('path/logo.png');
    expect(merged.motto).toBe('');
    expect(merged.materialPrefix).toBe('PVC');
  });

  it('seedLotFaceFromRows keys by original sku', () => {
    const rows = [sampleRow(), sampleRow({ tamanho: '35', codigoBarra: '105743' })];
    const map = seedLotFaceFromRows(rows, 'baby_nalin');
    expect(Object.keys(map)).toHaveLength(2);
    expect(map[clientOrderLineSkuKey(rows[0]!)]?.tamanho).toBe('34');
    expect(map[clientOrderLineSkuKey(rows[1]!)]?.tamanho).toBe('35');
  });
});

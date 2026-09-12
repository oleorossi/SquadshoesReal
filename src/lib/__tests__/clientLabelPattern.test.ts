import { describe, expect, it } from 'vitest';
import {
  activatePattern,
  clientOrderLineSkuKey,
  collectionPatternKeys,
  defaultPatternForKey,
  emptyLabelCollection,
  isClientLabelPatternKey,
  normalizeClientLabelCollection,
  normalizeClientLabelPattern,
  patternLabel,
  removePattern,
  savedPatternStatusLabel,
  toPersistedLabelPattern,
  upsertActivePattern,
} from '@/lib/clientLabelPattern';

describe('clientLabelPattern', () => {
  it('default Objetiva usa prefixo PU/SO e motto DEUS É FIEL', () => {
    const pattern = defaultPatternForKey('objetiva');
    expect(pattern.key).toBe('objetiva');
    expect(pattern.branding.materialPrefix).toBe('PU/SO');
    expect(pattern.branding.motto).toBe('DEUS É FIEL');
    expect(pattern.geometry.columns).toBe(1);
  });

  it('default Baby Nalin usa geometria 2 colunas L42PRO', () => {
    const pattern = defaultPatternForKey('baby_nalin');
    expect(pattern.key).toBe('baby_nalin');
    expect(pattern.geometry.columns).toBe(2);
    expect(pattern.geometry.labelWidthMm).toBe(50);
  });

  it('normalizeClientLabelPattern sempre devolve contrato v1', () => {
    const fromNull = normalizeClientLabelPattern(null);
    expect(fromNull.key).toBe('baby_nalin');
    expect(fromNull.version).toBe(1);

    const objetiva = normalizeClientLabelPattern({ key: 'objetiva', geometry: {}, branding: {} });
    expect(objetiva.key).toBe('objetiva');
    expect(objetiva.branding.materialPrefix).toBe('PU/SO');

    const patched = normalizeClientLabelPattern({
      key: 'objetiva',
      geometry: { labelWidthMm: 40, columns: 2 },
      branding: { motto: 'CUSTOM', materialPrefix: 'PVC' },
    });
    expect(patched.geometry.labelWidthMm).toBe(40);
    expect(patched.geometry.columns).toBe(2);
    expect(patched.branding.motto).toBe('CUSTOM');
    expect(patched.branding.materialPrefix).toBe('PVC');
  });

  it('isClientLabelPatternKey e patternLabel cobrem os layouts', () => {
    expect(isClientLabelPatternKey('baby_nalin')).toBe(true);
    expect(isClientLabelPatternKey('objetiva')).toBe(true);
    expect(isClientLabelPatternKey('outro')).toBe(false);
    expect(patternLabel('baby_nalin')).toBe('Nalin');
    expect(patternLabel('objetiva')).toBe('Objetiva');
  });

  it('clientOrderLineSkuKey inclui ref/cor/tamanho/código', () => {
    expect(
      clientOrderLineSkuKey({
        tamanho: '33',
        cor: 'PRETO',
        referencia: '112334',
        codProduto: '112334',
        codigoBarra: '112334',
        quantidade: 1,
      }),
    ).toContain('112334');
  });

  it('normalizeClientLabelCollection promove v1 sem perder o tipo', () => {
    const objetiva = defaultPatternForKey('objetiva');
    const collection = normalizeClientLabelCollection(objetiva);
    expect(collection.version).toBe(2);
    expect(collection.activeKey).toBe('objetiva');
    expect(collection.patterns.objetiva?.branding.motto).toBe('DEUS É FIEL');
    expect(collection.patterns.baby_nalin).toBeUndefined();
  });

  it('coleção v2 guarda Nalin e Objetiva no mesmo cliente', () => {
    const nalin = defaultPatternForKey('baby_nalin');
    const objetiva = defaultPatternForKey('objetiva');
    const both = normalizeClientLabelCollection({
      version: 2,
      activeKey: 'objetiva',
      patterns: { baby_nalin: nalin, objetiva },
    });
    expect(collectionPatternKeys(both)).toEqual(['baby_nalin', 'objetiva']);
    expect(both.activeKey).toBe('objetiva');
    expect(savedPatternStatusLabel(both)).toBe('Nalin + Objetiva');
  });

  it('upsert de um tipo não apaga o outro já gravado', () => {
    const started = activatePattern(emptyLabelCollection(), 'baby_nalin');
    const withObjetiva = upsertActivePattern(started, defaultPatternForKey('objetiva'));
    expect(collectionPatternKeys(withObjetiva)).toEqual(['baby_nalin', 'objetiva']);
    expect(withObjetiva.activeKey).toBe('objetiva');
    expect(withObjetiva.patterns.baby_nalin?.geometry.columns).toBe(2);
  });

  it('trocar o tipo ativo não descarta o padrão anterior', () => {
    const nalin = {
      ...defaultPatternForKey('baby_nalin'),
      geometry: { ...defaultPatternForKey('baby_nalin').geometry, columnGapMm: 8 },
    };
    const collection = upsertActivePattern(emptyLabelCollection(), nalin);
    const switched = activatePattern(collection, 'objetiva');
    expect(switched.activeKey).toBe('objetiva');
    expect(switched.patterns.baby_nalin?.geometry.columnGapMm).toBe(8);
    expect(switched.patterns.objetiva?.key).toBe('objetiva');
  });

  it('remover um tipo deixa o outro e persistir vazio grava null', () => {
    const both = upsertActivePattern(
      activatePattern(emptyLabelCollection(), 'baby_nalin'),
      defaultPatternForKey('objetiva'),
    );
    const onlyNalin = removePattern(both, 'objetiva');
    expect(collectionPatternKeys(onlyNalin)).toEqual(['baby_nalin']);
    expect(onlyNalin.activeKey).toBe('baby_nalin');

    const empty = removePattern(onlyNalin, 'baby_nalin');
    expect(toPersistedLabelPattern(empty)).toBeNull();
    expect(savedPatternStatusLabel(null)).toBe('sem padrão');
  });
});

import { describe, it, expect } from 'vitest';
import {
  facaLabelForSize,
  expandFacasByBoundaries,
  boundariesFromBuckets,
  resolveSheetFacas,
  sizeToFacaMap,
  type FacaBoundary,
  type KnifeBucket,
} from '@/lib/knifeFacas';

// Padrão global típico: P até 36, M até 39, G = resto.
const DEFAULT: FacaBoundary[] = [
  { label: 'P', upTo: '36' },
  { label: 'M', upTo: '39' },
  { label: 'G', upTo: null },
];

describe('knifeFacas — facaLabelForSize', () => {
  it('mapeia numeração pela faixa (inclusive) com resto na última', () => {
    expect(facaLabelForSize('34', DEFAULT)).toBe('P');
    expect(facaLabelForSize('36', DEFAULT)).toBe('P');
    expect(facaLabelForSize('37', DEFAULT)).toBe('M');
    expect(facaLabelForSize('39', DEFAULT)).toBe('M');
    expect(facaLabelForSize('40', DEFAULT)).toBe('G');
    expect(facaLabelForSize('44', DEFAULT)).toBe('G'); // acima de todos → resto
  });

  it('sem faca "resto" (todas com upTo), numeração maior cai na última', () => {
    const b: FacaBoundary[] = [{ label: 'P', upTo: '35' }, { label: 'G', upTo: '40' }];
    expect(facaLabelForSize('41', b)).toBe('G');
  });

  it('retorna null sem boundaries', () => {
    expect(facaLabelForSize('34', [])).toBeNull();
  });
});

describe('knifeFacas — expandFacasByBoundaries', () => {
  it('agrupa numerações nas facas certas e descarta faca vazia', () => {
    const out = expandFacasByBoundaries(['34', '35', '36', '37', '38'], DEFAULT);
    expect(out).toEqual([
      { label: 'P', sizes: ['34', '35', '36'], code: undefined },
      { label: 'M', sizes: ['37', '38'], code: undefined },
      // G fica vazio (não há ≥40) → descartado
    ]);
  });

  it('o cenário do user: P={34,35,36} → soma fecha em 1 faca', () => {
    const b: FacaBoundary[] = [{ label: 'P', upTo: '36' }];
    const out = expandFacasByBoundaries(['34', '35', '36'], b);
    expect(out).toEqual([{ label: 'P', sizes: ['34', '35', '36'], code: undefined }]);
    // soma de 12+12+12 por faca é responsabilidade do motor; aqui validamos o mapa
    const map = sizeToFacaMap(out)!;
    expect(map.get('34')).toBe('P');
    expect(map.get('35')).toBe('P');
    expect(map.get('36')).toBe('P');
  });
});

describe('knifeFacas — boundariesFromBuckets (semear UI / salvar como padrão)', () => {
  it('deriva upTo do maior size; última vira resto (null)', () => {
    const buckets: KnifeBucket[] = [
      { label: 'P', sizes: ['34', '35', '36'] },
      { label: 'M', sizes: ['37', '38', '39'] },
      { label: 'G', sizes: ['40', '41', '42'] },
    ];
    expect(boundariesFromBuckets(buckets)).toEqual([
      { label: 'P', upTo: '36', code: undefined },
      { label: 'M', upTo: '39', code: undefined },
      { label: 'G', upTo: null, code: undefined },
    ]);
  });
});

describe('knifeFacas — resolveSheetFacas (precedência)', () => {
  const sizes = ['34', '35', '36', '37', '38', '39', '40'];

  it('override com itens vence o padrão', () => {
    const override: KnifeBucket[] = [{ label: 'P', sizes: ['34', '35'] }, { label: 'G', sizes: ['36', '37', '38', '39', '40'] }];
    expect(resolveSheetFacas(override, DEFAULT, sizes)).toBe(override);
  });

  it('override = [] é opt-out (numeração individual)', () => {
    expect(resolveSheetFacas([], DEFAULT, sizes)).toBeNull();
  });

  it('null herda o padrão global expandido', () => {
    const out = resolveSheetFacas(null, DEFAULT, sizes)!;
    expect(out.map((b) => b.label)).toEqual(['P', 'M', 'G']);
    expect(out.find((b) => b.label === 'P')!.sizes).toEqual(['34', '35', '36']);
    expect(out.find((b) => b.label === 'G')!.sizes).toEqual(['40']);
  });

  it('null sem padrão → sem faca', () => {
    expect(resolveSheetFacas(null, null, sizes)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import {
  pmgLabelForSize,
  expandPmgByBoundaries,
  boundariesFromPmgBuckets,
  resolveSheetPmg,
  sizeToPmgMap,
  sortSizesNumeric,
  type PmgBoundary,
  type PmgBucket,
} from './aviamentoSizeRanges';

// Padrão típico P/M/G: P até 36, M até 38, G = resto.
const PMG: PmgBoundary[] = [
  { label: 'P', upTo: '36' },
  { label: 'M', upTo: '38' },
  { label: 'G', upTo: null },
];

describe('sortSizesNumeric', () => {
  it('ordena por valor numérico e descarta não-numéricos', () => {
    expect(sortSizesNumeric(['40', '34', '37', 'X'])).toEqual(['34', '37', '40']);
  });
});

describe('pmgLabelForSize', () => {
  it('mapeia numeração pra faixa pela faixa contígua', () => {
    expect(pmgLabelForSize('34', PMG)).toBe('P');
    expect(pmgLabelForSize('36', PMG)).toBe('P'); // inclusive no upTo
    expect(pmgLabelForSize('37', PMG)).toBe('M');
    expect(pmgLabelForSize('38', PMG)).toBe('M');
    expect(pmgLabelForSize('39', PMG)).toBe('G'); // resto
    expect(pmgLabelForSize('44', PMG)).toBe('G'); // acima de tudo → resto
  });

  it('sem faixa "resto" cai na última faixa pra numerações acima de tudo', () => {
    const semResto: PmgBoundary[] = [
      { label: 'P', upTo: '36' },
      { label: 'G', upTo: '40' },
    ];
    expect(pmgLabelForSize('45', semResto)).toBe('G');
  });

  it('retorna null sem boundaries ou pra numeração inválida', () => {
    expect(pmgLabelForSize('34', [])).toBeNull();
    expect(pmgLabelForSize('X', PMG)).toBeNull();
  });

  it('é robusto a boundaries fora de ordem', () => {
    const desordenado: PmgBoundary[] = [
      { label: 'G', upTo: null },
      { label: 'M', upTo: '38' },
      { label: 'P', upTo: '36' },
    ];
    expect(pmgLabelForSize('35', desordenado)).toBe('P');
    expect(pmgLabelForSize('37', desordenado)).toBe('M');
    expect(pmgLabelForSize('41', desordenado)).toBe('G');
  });
});

describe('expandPmgByBoundaries', () => {
  it('expande boundaries em buckets explícitos contra as numerações', () => {
    const buckets = expandPmgByBoundaries(['33', '34', '35', '36', '37', '38', '39', '40', '41'], PMG);
    expect(buckets).toEqual([
      { label: 'P', sizes: ['33', '34', '35', '36'] },
      { label: 'M', sizes: ['37', '38'] },
      { label: 'G', sizes: ['39', '40', '41'] },
    ]);
  });

  it('descarta faixas que ficam vazias', () => {
    const buckets = expandPmgByBoundaries(['39', '40', '41'], PMG);
    expect(buckets.map(b => b.label)).toEqual(['G']);
  });

  it('soma das numerações dos buckets cobre todas as numerações mapeadas', () => {
    const sizes = ['34', '35', '36', '37', '38', '39'];
    const buckets = expandPmgByBoundaries(sizes, PMG);
    const flat = buckets.flatMap(b => b.sizes);
    expect(sortSizesNumeric(flat)).toEqual(sizes);
  });
});

describe('boundariesFromPmgBuckets', () => {
  it('deriva boundaries (a última vira resto) ordenadas por menor numeração', () => {
    const buckets: PmgBucket[] = [
      { label: 'M', sizes: ['37', '38'] },
      { label: 'P', sizes: ['34', '35', '36'] },
      { label: 'G', sizes: ['39', '40'] },
    ];
    expect(boundariesFromPmgBuckets(buckets)).toEqual([
      { label: 'P', upTo: '36' },
      { label: 'M', upTo: '38' },
      { label: 'G', upTo: null },
    ]);
  });

  it('round-trip: expand → boundariesFrom preserva o mapeamento', () => {
    const sizes = ['33', '34', '35', '36', '37', '38', '39', '40', '41'];
    const buckets = expandPmgByBoundaries(sizes, PMG);
    const back = boundariesFromPmgBuckets(buckets);
    expect(expandPmgByBoundaries(sizes, back)).toEqual(buckets);
  });
});

describe('resolveSheetPmg (precedência override → opt-out → padrão global)', () => {
  const sizes = ['34', '35', '36', '37', '38', '39'];

  it('override com itens vence o padrão global', () => {
    const override: PmgBucket[] = [{ label: 'ÚNICO', sizes }];
    expect(resolveSheetPmg(override, PMG, sizes)).toBe(override);
  });

  it('override [] = opt-out → null (numeração individual)', () => {
    expect(resolveSheetPmg([], PMG, sizes)).toBeNull();
  });

  it('override null herda o padrão global expandido', () => {
    const r = resolveSheetPmg(null, PMG, sizes);
    expect(r?.map(b => b.label)).toEqual(['P', 'M', 'G']);
  });

  it('sem override e sem padrão global → null', () => {
    expect(resolveSheetPmg(null, null, sizes)).toBeNull();
  });
});

describe('sizeToPmgMap', () => {
  it('monta o mapa numeração → label', () => {
    const buckets = expandPmgByBoundaries(['34', '37', '40'], PMG);
    const m = sizeToPmgMap(buckets);
    expect(m?.get('34')).toBe('P');
    expect(m?.get('37')).toBe('M');
    expect(m?.get('40')).toBe('G');
  });

  it('retorna null pra buckets vazios/nulos', () => {
    expect(sizeToPmgMap(null)).toBeNull();
    expect(sizeToPmgMap([])).toBeNull();
  });
});

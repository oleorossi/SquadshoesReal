import { describe, it, expect } from 'vitest';
import {
  ditherToMonochrome,
  monoToZplDownloadGraphic,
  monoToRgba,
  zplGraphicName,
  zplRecallGraphic,
  mmToDots,
  type RgbaPixels,
} from '../zplImage';

/** Constrói pixels RGBA a partir de uma matriz de cinza 0..255. */
const pixels = (rows: number[][], alpha = 255): RgbaPixels => {
  const height = rows.length, width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => row.forEach((v, x) => {
    const o = (y * width + x) * 4;
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = alpha;
  }));
  return { data, width, height };
};

/** Lê um pixel do bitmap: true = ponto queimado. */
const dot = (m: ReturnType<typeof ditherToMonochrome>, x: number, y: number) =>
  (m.bits[y * m.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;

describe('ditherToMonochrome', () => {
  it('preto vira ponto queimado e branco não', () => {
    const m = ditherToMonochrome(pixels([[0, 255], [255, 0]]));
    expect([dot(m, 0, 0), dot(m, 1, 0), dot(m, 0, 1), dot(m, 1, 1)]).toEqual([true, false, false, true]);
  });

  it('alinha a linha em byte — 12 colunas ocupam 2 bytes', () => {
    const m = ditherToMonochrome(pixels([new Array(12).fill(0)]));
    expect(m.rowBytes).toBe(2);
    expect(m.bits).toHaveLength(2);
    // 12 pontos acesos: byte cheio + 4 bits altos = 0xFF 0xF0
    expect([...m.bits]).toEqual([0xff, 0xf0]);
  });

  it('bit mais significativo é o pixel mais à ESQUERDA (convenção do ZPL)', () => {
    const m = ditherToMonochrome(pixels([[0, 255, 255, 255, 255, 255, 255, 255]]));
    expect(m.bits[0]).toBe(0x80);
  });

  it('pixel transparente conta como BRANCO, não como preto', () => {
    // preto puro, mas alpha 0 — PNG de produto vem assim no fundo
    const m = ditherToMonochrome(pixels([[0, 0], [0, 0]], 0));
    expect([...m.bits].every(b => b === 0)).toBe(true);
  });

  it('cinza uniforme vira trama, não um bloco chapado', () => {
    // 50% de cinza em 8x8: o dithering tem que acender ALGUNS pontos, não todos nem nenhum
    const m = ditherToMonochrome(pixels(Array.from({ length: 8 }, () => new Array(8).fill(128))));
    let acesos = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (dot(m, x, y)) acesos++;
    expect(acesos).toBeGreaterThan(0);
    expect(acesos).toBeLessThan(64);
  });

  it('imagem vazia não estoura', () => {
    expect(ditherToMonochrome({ data: [], width: 0, height: 0 }).bits).toHaveLength(0);
  });
});

describe('monoToRgba — a prévia mostra os MESMOS bits do ZPL', () => {
  it('ida e volta preserva cada ponto', () => {
    const src = pixels([[0, 255, 0, 255], [255, 0, 255, 0]]);
    const mono = ditherToMonochrome(src);
    const rgba = monoToRgba(mono);
    for (let y = 0; y < mono.heightDots; y++) {
      for (let x = 0; x < mono.widthDots; x++) {
        const esperado = dot(mono, x, y) ? 0 : 255;
        expect(rgba.data[(y * rgba.width + x) * 4]).toBe(esperado);
      }
    }
  });

  it('é opaco — sem alpha a prévia mentiria sobre o fundo', () => {
    const rgba = monoToRgba(ditherToMonochrome(pixels([[0, 255]])));
    expect(rgba.data[3]).toBe(255);
    expect(rgba.data[7]).toBe(255);
  });
});

describe('monoToZplDownloadGraphic', () => {
  it('declara total e bytes-por-linha coerentes com os dados', () => {
    const mono = ditherToMonochrome(pixels(Array.from({ length: 4 }, () => new Array(16).fill(0))));
    const cmd = monoToZplDownloadGraphic('FOTO1', mono);
    const [, total, rowBytes] = cmd.match(/~DGR:FOTO1\.GRF,(\d+),(\d+),/)!;
    expect(Number(rowBytes)).toBe(2);
    expect(Number(total)).toBe(8); // 2 bytes × 4 linhas
    const hex = cmd.slice(cmd.lastIndexOf(',') + 1);
    expect(hex).toHaveLength(8 * 2); // 2 caracteres hex por byte
    expect(hex).toMatch(/^[0-9A-F]+$/);
  });

  it('bitmap vazio não emite comando (em vez de emitir um ~DG quebrado)', () => {
    expect(monoToZplDownloadGraphic('X', { widthDots: 0, heightDots: 0, rowBytes: 0, bits: new Uint8Array(0) })).toBe('');
  });
});

describe('zplGraphicName — nome é comando, não texto livre', () => {
  it('corta em 8 caracteres e sobe pra maiúscula', () => {
    expect(zplGraphicName('sp130-off-white')).toBe('SP130OFF');
  });

  it('remove tudo que não é A-Z0-9 — acento e símbolo quebrariam o ZPL', () => {
    // 'Ç' e 'Ã' caem; o 'O' de 'ÇÃO' é letra válida e fica. O que importa é que
    // NADA fora da allow-list sobreviva: '^' e '~' são delimitadores de comando.
    expect(zplGraphicName('cor: ÇÃO^~,')).toBe('CORO');
    for (const bruto of ['cor: ÇÃO^~,', 'SP130-OFF/WHITE', 'ação ^XA', '  ']) {
      expect(zplGraphicName(bruto)).toMatch(/^[A-Z0-9]{1,8}$/);
    }
  });

  it('nome que sobra vazio vira IMG em vez de string vazia', () => {
    expect(zplGraphicName('^~,')).toBe('IMG');
    expect(zplGraphicName('')).toBe('IMG');
  });

  it('a chamada ^XG usa o mesmo nome saneado do ~DG', () => {
    const nome = 'sp130 off white';
    expect(zplRecallGraphic(nome, 12, 9)).toBe('^FO12,9^XGR:SP130OFF.GRF,1,1^FS');
    expect(monoToZplDownloadGraphic(nome, ditherToMonochrome(pixels([[0]])))).toContain('R:SP130OFF.GRF');
  });
});

describe('mmToDots', () => {
  it('203 dpi: 20 mm = 160 dots, 22 mm = 176 dots', () => {
    expect(mmToDots(20)).toBe(160);
    expect(mmToDots(22)).toBe(176);
  });
});

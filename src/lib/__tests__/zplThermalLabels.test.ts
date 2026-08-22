import { describe, it, expect } from 'vitest';
import { buildThermalLabelsZpl, computeZplLayout, zplPhotoBoxDots } from '../printLabels';
import { ditherToMonochrome, type RgbaPixels } from '../zplImage';

const solidBlack = (w: number, h: number): RgbaPixels => ({
  data: new Uint8ClampedArray(w * h * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0)) as unknown as Uint8ClampedArray,
  width: w, height: h,
});

const mono = (w = 8, h = 8) => ditherToMonochrome(solidBlack(w, h));

const label = (over: Partial<Parameters<typeof buildThermalLabelsZpl>[0][number]> = {}) => ({
  refCode: 'SP130', refName: 'SP130 SANDALIA', mainMaterial: 'NAPA SOFT',
  color: 'OFF WHITE', size: '36', barcode: 'SP130-36', ...over,
});

describe('buildThermalLabelsZpl — foto 1 bit gravada uma vez', () => {
  it('emite ~DG UMA vez por foto distinta, antes de qualquer ^XA', () => {
    const zpl = buildThermalLabelsZpl(
      [label({ imageName: 'IMG0' }), label({ imageName: 'IMG0' }), label({ imageName: 'IMG1' })],
      { width: 100, height: 30 },
      [{ name: 'IMG0', mono: mono() }, { name: 'IMG1', mono: mono() }],
    );
    expect(zpl.match(/~DGR:/g)).toHaveLength(2);
    // o preâmbulo tem que vir ANTES da primeira etiqueta, senão o ^XG não acha nada
    expect(zpl.indexOf('~DGR:')).toBeLessThan(zpl.indexOf('^XA'));
    // três etiquetas chamam a imagem, mas só dois downloads
    expect(zpl.match(/\^XGR:/g)).toHaveLength(3);
    expect(zpl.match(/\^XA/g)).toHaveLength(3);
  });

  it('etiqueta sem imageName não chama ^XG', () => {
    const zpl = buildThermalLabelsZpl(
      [label({ imageName: 'IMG0' }), label()],
      { width: 100, height: 30 },
      [{ name: 'IMG0', mono: mono() }],
    );
    expect(zpl.match(/\^XGR:/g)).toHaveLength(1);
  });

  it('sem gráfico nenhum: nenhum ~DG e a descrição volta pra margem esquerda', () => {
    const zpl = buildThermalLabelsZpl([label()], { width: 100, height: 30 });
    expect(zpl).not.toContain('~DGR:');
    expect(zpl).not.toContain('^XGR:');

    const semFoto = computeZplLayout({ width: 100, height: 30 }, false);
    const comFoto = computeZplLayout({ width: 100, height: 30 }, true);
    expect(semFoto.infoX).toBe(semFoto.padX);
    expect(comFoto.infoX).toBeGreaterThan(semFoto.infoX);
  });

  it('a foto é posicionada nas coordenadas do layout compartilhado', () => {
    const L = computeZplLayout({ width: 100, height: 30 }, true);
    const zpl = buildThermalLabelsZpl(
      [label({ imageName: 'IMG0' })], { width: 100, height: 30 },
      [{ name: 'IMG0', mono: mono() }],
    );
    // é ESTE acoplamento que faz a prévia valer como prova: os dois lados leem
    // as mesmas coordenadas de computeZplLayout
    expect(zpl).toContain(`^FO${L.photoX},${L.photoY}^XGR:IMG0.GRF,1,1^FS`);
  });

  it('moldura da foto cabe na altura útil da etiqueta', () => {
    const box30 = zplPhotoBoxDots({ width: 100, height: 30 });
    const L30 = computeZplLayout({ width: 100, height: 30 }, true);
    expect(box30.height).toBeLessThanOrEqual(L30.innerH);

    // etiqueta baixa: a foto encolhe em vez de vazar
    const box20 = zplPhotoBoxDots({ width: 100, height: 20 });
    const L20 = computeZplLayout({ width: 100, height: 20 }, true);
    expect(box20.height).toBeLessThanOrEqual(L20.innerH);
    expect(box20.height).toBeLessThan(box30.height);
  });

  it('203 dpi: etiqueta 100×30 mm = 799×240 dots', () => {
    const L = computeZplLayout({ width: 100, height: 30 });
    expect(L.W).toBe(799);
    expect(L.H).toBe(240);
  });

  it('cada etiqueta continua um bloco ^XA…^XZ fechado', () => {
    const zpl = buildThermalLabelsZpl([label(), label()], { width: 100, height: 30 });
    expect(zpl.match(/\^XA/g)).toHaveLength(2);
    expect(zpl.match(/\^XZ/g)).toHaveLength(2);
  });

  it('caractere de comando no cadastro não vira comando (^ e ~ neutralizados)', () => {
    const zpl = buildThermalLabelsZpl([label({ refName: 'SP130^XZ~DG', barcode: 'A^B~C' })], { width: 100, height: 30 });
    // o texto passa por ^FH (hex escape) e o barcode por allow-list
    expect(zpl.match(/\^XZ/g)).toHaveLength(1); // só o fechamento legítimo
    expect(zpl).not.toContain('~DG');
  });
});

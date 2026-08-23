import { describe, it, expect } from 'vitest';
import {
  buildThermalLabelsHtml,
  buildBoxIdentificationHtml,
  computeThermalLabelFrame,
  DEFAULT_THERMAL_CONFIG,
  THERMAL_SAFE_EDGE_MM,
  THERMAL_LABEL_WIDTH_MM,
  THERMAL_LABEL_HEIGHT_MM,
  type BoxIdentificationData,
} from '../printLabels';
import {
  COUCHE_COLUMNS,
  COUCHE_LABEL_HEIGHT_MM,
  COUCHE_LABEL_WIDTH_MM,
  COUCHE_PAGE_HEIGHT_MM,
  COUCHE_PAGE_WIDTH_MM,
  DEFAULT_COUCHE_ROLL_PROFILE,
} from '../babyNalinLabels';

const label = (barcode: string, size: string) => ({
  refCode: 'SP130', refName: 'SP130', mainMaterial: 'NAPA SOFT',
  color: 'OFF WHITE', size, barcode,
});

/**
 * Caso real de 22/08/2026: 1.136 pares no modo "Qtd. Total (1:1)" produzem uma
 * etiqueta por par, mas o payload é `REF-numeração` — poucos códigos distintos
 * repetidos centenas de vezes. A versão anterior emitia um JsBarcode por
 * ETIQUETA, síncrono, e a janela de impressão demorava a ficar pronta.
 */
describe('buildThermalLabelsHtml — barcode por payload distinto', () => {
  // 7 numerações × 40 pares = 280 etiquetas, 7 códigos distintos
  const sizes = ['34', '35', '36', '37', '38', '39', '40'];
  const many = sizes.flatMap(s => Array.from({ length: 40 }, () => label(`SP130-${s}`, s)));

  it('gera 280 etiquetas mas apenas 7 jobs de barcode', () => {
    const html = buildThermalLabelsHtml(many, 'logo.png');
    expect(html.match(/id="bc-\d+"/g)).toHaveLength(280);

    const jobs = JSON.parse(html.match(/var _bcJobs=(\[.*?\]);\n/s)![1]);
    expect(jobs).toHaveLength(7);
    expect(jobs.map((j: [string, number[]]) => j[0]).sort()).toEqual(sizes.map(s => `SP130-${s}`));
    // cada payload cobre os 40 slots que o repetem
    for (const [, slots] of jobs) expect(slots).toHaveLength(40);
  });

  it('chama JsBarcode uma vez no laço, não uma vez por etiqueta', () => {
    const html = buildThermalLabelsHtml(many, 'logo.png');
    expect(html.match(/JsBarcode\(/g)).toHaveLength(1);
    expect(html).toContain('cloneNode(true)');
  });

  it('todo slot repetido recebe id próprio (sem id duplicado no DOM)', () => {
    const html = buildThermalLabelsHtml(many, 'logo.png');
    expect(html).toContain("clone.id='bc-'+slots[k]");
  });

  it('payload malicioso não fecha a tag <script>', () => {
    const html = buildThermalLabelsHtml([label('</script><img onerror=alert(1)>', '34')], 'logo.png');
    const scriptBody = html.slice(html.indexOf('var _bcJobs='));
    expect(scriptBody.slice(0, scriptBody.indexOf('\n'))).not.toContain('</script>');
    expect(html).toContain('\\u003c/script>');
  });

  it('sem barcode nenhum, não emite o laço', () => {
    const html = buildThermalLabelsHtml([{ ...label('', '34') }], 'logo.png');
    expect(html).not.toContain('var _bcJobs=');
  });

  it('mantém a página 100×30 mm e centraliza a arte na área segura de 98×28 mm', () => {
    const frame = computeThermalLabelFrame({ width: 100, height: 30 });

    expect(DEFAULT_THERMAL_CONFIG.marginPct).toBe(0);
    expect(THERMAL_SAFE_EDGE_MM).toBe(1);
    expect(THERMAL_LABEL_WIDTH_MM).toBe(100);
    expect(THERMAL_LABEL_HEIGHT_MM).toBe(30);
    expect(frame.safePadX).toBe(1);
    expect(frame.safePadY).toBe(1);
    expect(frame.artWidthMm).toBe(98);
    expect(frame.artHeightMm).toBe(28);
    expect(frame.innerW).toBe(98);
    expect(frame.shellTopMm + frame.innerH + frame.shellBottomMm).toBeCloseTo(30, 6);

    const html = buildThermalLabelsHtml([label('SP130-34', '34')], 'logo.png');
    expect(html).toContain('@page{size:100mm 30mm;margin:0;}');
    expect(html).toContain('width:100mm;\n    height:30mm;');
    expect(html).toContain('top:1mm;left:1mm;right:1mm;');
    expect(html).toContain('bottom:1mm;left:1mm;right:1mm;');
    expect(html).toContain('bottom:1mm;\n    left:1mm;');
  });

  it('não mistura a caixa individual 100×30 com a etiquetagem cliente 2×50×30', () => {
    expect(THERMAL_LABEL_WIDTH_MM).toBe(100);
    expect(THERMAL_LABEL_HEIGHT_MM).toBe(30);
    expect(COUCHE_LABEL_WIDTH_MM).toBe(50);
    expect(COUCHE_LABEL_HEIGHT_MM).toBe(30);
    expect(COUCHE_COLUMNS).toBe(2);
    expect(DEFAULT_COUCHE_ROLL_PROFILE.columnGapMm).toBe(6);
    expect(COUCHE_PAGE_WIDTH_MM).toBe(106);
    expect(COUCHE_PAGE_HEIGHT_MM).toBe(30);
    expect(THERMAL_LABEL_WIDTH_MM).not.toBe(COUCHE_PAGE_WIDTH_MM);
  });

  it('amplia a numeração curta e ancora o valor no canto inferior direito', () => {
    const html = buildThermalLabelsHtml([label('SP130-34', '34')], 'logo.png');

    expect(DEFAULT_THERMAL_CONFIG.fontSizeSize).toBe(34);
    expect(html).toContain('class="sz-value" style="font-size:34pt">34</span>');
    expect(html).toContain('align-self:end;');
    expect(html).toContain('justify-self:end;');
  });

  it('reduz somente o valor quando o modo por ficha envia uma grade longa', () => {
    const html = buildThermalLabelsHtml([label('SP130-GRADE', '34(2) 35(3)')], 'logo.png');

    expect(html).toContain('class="sz-value sz-value--long" style="font-size:10pt">34(2) 35(3)</span>');
  });

  it('respeita margem extra escolhida pelo operador sem impor 3% ocultos', () => {
    const semMargem = computeThermalLabelFrame({ width: 100, height: 30 }, 0);
    const comMargem = computeThermalLabelFrame({ width: 100, height: 30 }, 3);

    expect(semMargem.safePadX).toBe(1);
    expect(comMargem.safePadX).toBe(4);
    expect(comMargem.innerW).toBeLessThan(semMargem.innerW);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const boxItem = (barcode: string, n: number): BoxIdentificationData => ({
  orderNumber: barcode,
  refCode: 'SP130', refName: 'SP130', color: 'OFF WHITE', mainMaterial: 'NAPA SOFT',
  recipientName: 'ELIANE', senderName: 'SQUAD SHOES', senderCnpj: '',
  boxNumber: n, totalBoxes: 100,
  grade: [{ size: '34', qty: 1 }], barcode,
});

/**
 * O rótulo de caixa é o caso MAIS extremo: o código é `order.order_number`, e
 * em individual_fitilho a capacidade é 1 par por caixa — 1.759 rótulos para 23
 * códigos distintos na seleção medida em 22/08/2026.
 */
describe('buildBoxIdentificationHtml — barcode por código distinto', () => {
  it('100 caixas de 2 OPs geram 2 jobs de barcode, não 100', () => {
    const items = [
      ...Array.from({ length: 60 }, (_, i) => boxItem('OP-2026-01164', i + 1)),
      ...Array.from({ length: 40 }, (_, i) => boxItem('OP-2026-01165', i + 1)),
    ];
    const html = buildBoxIdentificationHtml(items);
    const jobs = JSON.parse(html.match(/var _bxJobs=(\[.*?\]);\n/s)![1]);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j: [string, number[]]) => j[1].length)).toEqual([60, 40]);
    expect(html.match(/JsBarcode\(/g)).toHaveLength(1);
  });

  it('mantém displayValue:true — o rótulo de caixa mostra o código legível', () => {
    const html = buildBoxIdentificationHtml([boxItem('OP-1', 1)]);
    expect(html).toContain('displayValue:true');
    expect(html).toContain('fontSize:13');
  });

  it('payload malicioso não fecha a tag <script>', () => {
    const html = buildBoxIdentificationHtml([boxItem('</script><img onerror=alert(1)>', 1)]);
    const line = html.slice(html.indexOf('var _bxJobs='));
    expect(line.slice(0, line.indexOf('\n'))).not.toContain('</script>');
  });

  it('sem barcode nenhum, não emite o laço', () => {
    const html = buildBoxIdentificationHtml([boxItem('', 1)]);
    expect(html).not.toContain('var _bxJobs=');
  });
});

import { describe, it, expect } from 'vitest';
import { buildThermalLabelsHtml } from '../printLabels';

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
});

// ─────────────────────────────────────────────────────────────────────────────

import { buildBoxIdentificationHtml } from '../printLabels';

const boxItem = (barcode: string, n: number) => ({
  refCode: 'SP130', refName: 'SP130', color: 'OFF WHITE', mainMaterial: 'NAPA SOFT',
  clientName: 'ELIANE', boxNumber: n, totalBoxes: 100, quantity: 1,
  grade: [{ size: '34', qty: 1 }], barcode,
}) as any;

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

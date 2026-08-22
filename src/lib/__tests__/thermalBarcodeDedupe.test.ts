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

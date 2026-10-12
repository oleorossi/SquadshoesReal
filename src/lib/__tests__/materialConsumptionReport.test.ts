import { describe, expect, it } from 'vitest';
import {
  aggregateStrapTypeColorLines,
  buildMaterialConsumptionReportHtml,
  computeMaterialsSpendTotal,
  materialConsumptionReportFilename,
} from '@/lib/materialConsumptionReport';
import type { ConsumptionRow } from '@/lib/consumptionRows';
import { PV00195_ROWS, PV00195_STRAP_CUT_ROWS } from '@/lib/__tests__/fixtures/pv00195Consumption';

/** Recorte do HTML entre dois marcadores (ex.: só o §02). */
const between = (html: string, start: string, end: string): string => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return html.slice(from, to);
};
/** §02 — do título até o rodapé (o §03 foi absorvido em 12/10/2026). */
const section02 = (html: string) => {
  const from = html.indexOf('Materiais por aplicação');
  const to = html.indexOf('<p class="footer-note">');
  expect(from).toBeGreaterThanOrEqual(0);
  return html.slice(from, to > from ? to : undefined);
};
/**
 * Um dos dois blocos de tira do §02. Desde 12/10/2026 a tira é partida por
 * ORIGEM: "comprar pronto" leva a coluna de dinheiro, "prestador" leva a napa
 * e a situação — e esse segundo bloco é o antigo §03 Setor de Tiras, absorvido.
 */
const strapBlock = (html: string, kind: 'comprar pronto' | 'prestador'): string => {
  const s02 = section02(html);
  const from = s02.indexOf(`<span>Tiras · ${kind}`);
  if (from < 0) return ''; // PV sem esse destino não imprime o bloco.
  return s02.slice(from, s02.indexOf('</table>', from));
};
/** Linhas de TIPO (a que carrega o subtotal) de um bloco de tira. */
const strapTypeRows = (html: string, kind: 'comprar pronto' | 'prestador'): string[] =>
  strapBlock(html, kind).match(/<tr class="strap-type[\s\S]*?<\/tr>/g) || [];
/** Linhas de COR (o detalhe sob o tipo) de um bloco de tira. */
const strapColorRows = (html: string, kind: 'comprar pronto' | 'prestador'): string[] =>
  strapBlock(html, kind).match(/<tr class="strap-color[\s\S]*?<\/tr>/g) || [];
/** Todas as linhas de tira dos dois blocos — tipo + cor. */
const strapBlockRows = (html: string): string[] => [
  ...strapTypeRows(html, 'comprar pronto'), ...strapColorRows(html, 'comprar pronto'),
  ...strapTypeRows(html, 'prestador'), ...strapColorRows(html, 'prestador'),
];

const row = (overrides: Partial<ConsumptionRow>): ConsumptionRow => ({
  componentType: 'Químicos',
  groupName: 'COLA',
  materialName: 'Componente',
  color: '—',
  productUnit: 'kg',
  totalQuantity: 2,
  available: 1,
  ...overrides,
} as ConsumptionRow);

describe('materialConsumptionReport', () => {
  it('gera o mesmo manifesto operacional da tela, com falta líquida e grade', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00157',
      generatedAt: new Date('2026-08-16T14:03:00-03:00'),
      artisanalStrapRows: [],
      rows: [
        row({ componentType: 'Forração Palmilha', groupName: 'NAPA SOFT', materialName: 'Forração Palmilha', color: 'CAPUCCINO', productUnit: 'm', totalQuantity: 13.51, available: 0 }),
        row({ componentType: 'Embalagem', groupName: 'EMBALAGEM', materialName: 'CAIXA COLMEIA 11', productUnit: 'un', totalQuantity: 72, available: 0 }),
        row({
          componentType: 'Solado',
          groupName: 'SOLADO 01',
          materialName: 'Solado',
          color: 'CARAMELO',
          productUnit: 'par',
          totalQuantity: 24,
          soleProductId: 'sole-1',
          sizeBreakdown: { '34': 12, '35': 12 },
          // O estoque excedente do 40 não atende a necessidade 34/35 e não
          // pode inflar a coluna "Estoque" do PDF.
          soleSizeStock: { '34': 2, '35': 12, '40': 100 },
        }),
      ],
    });

    expect(html).toContain('Necessidade de material base');
    expect(html).toContain('Materiais por aplicação');
    expect(html).toContain('CAIXA COLMEIA 11');
    expect(html).toContain('72');
    expect(html).toContain('SOLADO 01');
    expect(html).toContain('10'); // falta do nº 34: 12 − 2
    expect(html).toContain('<td class="num">14</td>'); // estoque útil = 2 + 12
    expect(html).not.toContain('<td class="num">114</td>'); // soma bruta da grade
    expect(html).toContain('16/08/2026');
  });

  it('mantém identidade editorial limitada e escapa dados do pedido', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'PV <script>alert(1)</script>',
      rows: [row({})],
      artisanalStrapRows: [],
      generatedAt: new Date('2026-08-16T14:03:00-03:00'),
    });

    expect(html).toContain('PV &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('--accent:#d9264e');
    // O PDF anterior usava uma cor diferente por setor; o novo documento usa
    // preto/off-white + um único acento operacional.
    expect(html).not.toContain('#8b5cf6');
    expect(html).not.toContain('#6366f1');
    expect(html).toContain("font-family:'Anton'");
    expect(html).toContain("font-family:'Fira Code'");
  });

  it('leva a prévia de quantidade das tiras para o PDF sem criar falta', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00157',
      artisanalStrapRows: [],
      rows: [row({
        componentType: 'Tiras',
        groupName: 'TIRA CHATA 8MM',
        materialName: 'Tira 1',
        color: 'CAPUCCINO',
        productUnit: 'm',
        totalQuantity: 0,
        previewQuantity: 17.25,
        available: 0,
        warning: 'Quantidade ainda não liberada para estoque.',
      })],
    });

    expect(html).toContain('≈ 17,25');
    expect(html).toContain('prévia da ficha');
    expect(html).not.toContain('class="num shortage">17,25');
  });

  it('cria nome de arquivo estável e seguro', () => {
    expect(materialConsumptionReportFilename('Consumo de Materiais — PV-00157'))
      .toBe('consumo-de-materiais-pv-00157');
  });

  it('exibe um SKU compartilhado uma vez, com todas as aplicações e uma única disponibilidade', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total — PV-00168',
      artisanalStrapRows: [],
      rows: [
        row({
          componentType: 'Forração',
          groupName: 'NAPA SOFT',
          materialName: 'NAPA SOFT',
          color: 'OFF WHITE',
          productUnit: 'm',
          totalQuantity: 41.57,
          available: 50,
          productIds: ['napa-soft-off-white'],
        }),
        row({
          componentType: 'Cabedal',
          groupName: 'NAPA SOFT',
          materialName: 'NAPA SOFT',
          color: 'OFF WHITE',
          productUnit: 'm',
          totalQuantity: 17.47,
          available: 50,
          productIds: ['napa-soft-off-white'],
        }),
        row({
          componentType: 'Palmilha',
          groupName: 'PLACA EVA',
          materialName: 'Palmilha',
          color: 'BRANCO',
          productUnit: 'placa',
          totalQuantity: 4,
          available: 10,
          productIds: ['placa-eva-branco'],
        }),
      ],
    });

    expect(html.match(/<span>Aplicações compartilhadas<\/span>/g)).toHaveLength(1);
    expect(html).toContain('<td>Cabedal + Forração</td>');
    expect(html).toContain('<td class="num strong">59,04</td>');
    expect(html.match(/<td class="num">50,00<\/td>/g)).toHaveLength(1);
    expect(html.match(/<td class="num shortage">9,04<\/td>/g)).toHaveLength(1);
    expect(html.indexOf('<span>Aplicações compartilhadas</span>'))
      .toBeLessThan(html.indexOf('<span>Palmilha</span>'));
  });

  it('mantém o SKU composto do cabedal separado da napa pura da forração', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total — PV-00168',
      artisanalStrapRows: [],
      rows: [
        row({
          componentType: 'Cabedal',
          groupName: 'NAPA SOFT + MASSA BOX',
          materialName: 'NAPA SOFT + MASSA BOX',
          color: 'OFF WHITE',
          productUnit: 'm',
          totalQuantity: 17.47,
          available: 20,
          productIds: ['cabedal-composto-off-white'],
        }),
        row({
          componentType: 'Forração',
          groupName: 'NAPA SOFT',
          materialName: 'NAPA SOFT',
          color: 'OFF WHITE',
          productUnit: 'm',
          totalQuantity: 41.57,
          available: 50,
          productIds: ['napa-soft-off-white'],
        }),
      ],
    });

    expect(html).not.toContain('Aplicações compartilhadas');
    expect(html).toContain('<div class="component-heading"><span>Cabedal</span>');
    expect(html).toContain('<div class="component-heading"><span>Forração</span>');
    expect(html).toContain('<td><strong>NAPA SOFT + MASSA BOX</strong>');
    expect(html).toContain('<td><strong>NAPA SOFT</strong>');
    expect(html).toContain('<td class="num strong">17,47</td>');
    expect(html).toContain('<td class="num strong">41,57</td>');
    expect(html).not.toContain('<td class="num strong">59,04</td>');
  });

  it('tira Fazer convertida aparece com metros de TIRA (D8), nunca como falta — napa no bloco de prestador', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00168',
      generatedAt: new Date('2026-08-30T15:11:00-03:00'),
      artisanalStrapRows: [{
        key: 'tira-1',
        groupName: 'TIRA OVERLOCK 5 mm · NAPA SOFT · NEW WHISKY',
        color: 'NEW WHISKY',
        baseName: 'NAPA SOFT',
        largura_mm: 5,
        metros_necessarios: 1402.8,
        cut: {
          largura_mm: 5, metros_uteis_por_banda: 40, n_bandas: 36, cm_a_cortar: 18,
          rolos: 0.13, n_rolos_completos: 0, cm_no_ultimo_rolo: 18, valid: true, widthMissing: false,
        },
        canonical: {
          recipeId: 'recipe-1',
          baseRequiredM: 20.04,
          confirmedYieldMPerM: 70,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 70,
          transformationCostPerM: null,
          blockingReasons: [],
        },
      }],
      rows: [
        row({
          componentType: 'Forração Palmilha',
          groupName: 'NAPA SOFT',
          materialName: 'Forração Palmilha',
          color: 'NEW WHISKY',
          productUnit: 'm',
          totalQuantity: 20.21,
          available: 0,
          productIds: ['napa-new-whisky'],
        }),
        row({
          componentType: 'Tiras',
          groupName: 'TIRA OVERLOCK 5 mm · NAPA SOFT · NEW WHISKY',
          materialName: 'Produção interna',
          color: 'NEW WHISKY',
          productUnit: 'm',
          totalQuantity: 1402.8,
          available: 0,
          productIds: ['tira-overlock-new-whisky'],
          baseProductId: 'napa-new-whisky',
          artisanal: { baseName: 'NAPA SOFT', baseQty: 20.04, yieldPerMeter: 70 },
        }),
      ],
    });

    // §01: só Cabedal/Forração. Napa de tira: só no bloco de prestador
    // (11/10/2026 para o dado, 12/10/2026 para o lugar). Strip "Necessidade
    // total" não soma a napa convertida. A tira continua visível com os metros
    // de TIRA (D8) — não é falta de tira (não se compra tira Fazer).
    expect(html).toContain('<span>Tiras · prestador');
    expect(html).not.toContain('Napa para tiras');
    expect(html).toContain('20,04 m');
    expect(html).not.toContain('class="num shortage">1.402,80');
    expect(html).toContain('<td class="num strong">1.402,80 m</td>');
    // A linha da cor repete o número cru, sob o subtotal do tipo.
    expect(html).toContain('<td class="num">1.402,80</td>');
    const totalsStrip = html.match(/<div class="totals-strip">[\s\S]*?<\/div>/)?.[0] || '';
    expect(totalsStrip).toContain('20,21');
    expect(totalsStrip).not.toContain('40,25');
    expect(totalsStrip).not.toContain('1.402,80');
    const s01 = between(html, '<h2>Necessidade de napa</h2>', 'Materiais por aplicação');
    expect(s01).not.toContain('>Tira<');
    expect(section02(html)).toContain('>Forração Palmilha<');
    expect(html).toContain('20,21 m');
  });

  it('no modo consumo total ignora estoque e agrupa napa Cabedal/Forração por família', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total — PV-00168',
      generatedAt: new Date('2026-08-30T15:11:00-03:00'),
      mode: 'total',
      artisanalStrapRows: [{
        key: 'tira-1',
        groupName: 'TIRA OVERLOCK 5 mm · NAPA SOFT · NEW WHISKY',
        color: 'NEW WHISKY',
        baseName: 'NAPA SOFT',
        largura_mm: 5,
        metros_necessarios: 1402.8,
        cut: {
          largura_mm: 5, metros_uteis_por_banda: 40, n_bandas: 36, cm_a_cortar: 18,
          rolos: 0.13, n_rolos_completos: 0, cm_no_ultimo_rolo: 18, valid: true, widthMissing: false,
        },
        canonical: {
          recipeId: 'recipe-1',
          baseRequiredM: 20.04,
          confirmedYieldMPerM: 70,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 70,
          transformationCostPerM: null,
          blockingReasons: [],
        },
      }],
      rows: [
        row({
          componentType: 'Forração Palmilha',
          groupName: 'NAPA SOFT',
          materialName: 'Forração Palmilha',
          color: 'NEW WHISKY',
          productUnit: 'm',
          totalQuantity: 20.21,
          available: 0,
          productIds: ['napa-new-whisky'],
        }),
        row({
          componentType: 'Tiras',
          groupName: 'TIRA OVERLOCK 5 mm · NAPA SOFT · NEW WHISKY',
          materialName: 'Produção interna',
          color: 'NEW WHISKY',
          productUnit: 'm',
          totalQuantity: 1402.8,
          available: 0,
          productIds: ['tira-overlock-new-whisky'],
          baseProductId: 'napa-new-whisky',
          artisanal: { baseName: 'NAPA SOFT', baseQty: 20.04, yieldPerMeter: 70 },
        }),
      ],
    });

    expect(html).toContain('Consumo total · estoque ignorado');
    expect(html).toContain('napa-family-name');
    expect(html).toContain('NAPA SOFT');
    expect(html).toContain('NEW WHISKY');
    // Família = só a forração 20,21 — a napa da tira (20,04) fica no §03.
    expect(html).toMatch(/napa-family-qty">20,21 m</);
    expect(html).not.toContain('40,25');
    expect(html).toContain('Setor de Tiras');
    expect(html).toContain('20,04 m');
    expect(html).not.toContain('Itens em falta');
    expect(html).not.toContain('Maiores faltas');
    expect(html).not.toContain('>Estoque<');
    expect(html).not.toContain('>Falta<');
    expect(html).toContain('Necessidade');
    // D8: metros de tira visíveis em §02, separados da napa (§03).
    expect(html).toContain('<td class="num strong">1.402,80 m</td>');
  });

  it('PV-00193: strip de metros ignora tira pending e §02 lista só demanda pendente', () => {
    const forracao = (color: string) => row({
      componentType: 'Forração Palmilha',
      groupName: 'NAPA MADRID',
      materialName: 'NAPA MADRID',
      color,
      productUnit: 'm',
      totalQuantity: 28.15,
      available: 0,
    });
    const tiraOk = (color: string) => row({
      componentType: 'Tiras',
      groupName: `TIRA CHATA 8 mm · NAPA MADRID · ${color}`,
      materialName: 'Produção interna',
      color,
      productUnit: 'm',
      totalQuantity: 1044,
      available: 0,
      artisanal: { baseName: 'NAPA MADRID', baseQty: 14.91, yieldPerMeter: 70 },
    });
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total — PV-00193',
      generatedAt: new Date('2026-09-07T13:58:00-03:00'),
      mode: 'total',
      artisanalStrapRows: [],
      rows: [
        forracao('CAPUCCINO'), forracao('OFF WHITE'), forracao('ROCHA'),
        tiraOk('CAPUCCINO'), tiraOk('OFF WHITE'), tiraOk('ROCHA'),
        row({
          componentType: 'Tiras',
          groupName: 'Tira sem cadastro',
          materialName: 'Produção interna',
          color: 'OFF WHITE',
          productUnit: 'm',
          totalQuantity: 1044,
          available: 0,
          warning: 'Variante exata ativa nao encontrada',
          artisanal: {
            baseName: 'NAPA MADRID',
            baseQty: 0,
            yieldPerMeter: 0,
            pending: true,
          },
        }),
      ],
    });

    const totalsStrip = html.match(/<div class="totals-strip">[\s\S]*?<\/div>/)?.[0] || '';
    // Só a forração: 3×28,15 = 84,45 — sem a napa convertida (3×14,91, §03).
    expect(totalsStrip).toContain('84,45');
    expect(totalsStrip).not.toContain('129,18');
    expect(totalsStrip).not.toContain('1.173,21');
    expect(totalsStrip).not.toContain('1.044,00');
    expect(html).toContain('Tira com cadastro pendente');
    expect(html).toContain('pending-strip');
    // Família = forração 3×28,15 = 84,45 (tira ok e pending fora do §01).
    expect(html).toMatch(/napa-family-qty">84,45 m</);
    expect(html).not.toContain('rendimento pendente');
    // Pending aparece no bloco de prestador como cadastro incompleto.
    expect(html).toContain('<span>Tiras · prestador');
    expect(html).toContain('Tira sem cadastro');
    expect(html).toContain('is-pending');
  });

  it('napa de tira Massabox fica fora do total da família — só no §03 (PV-00169)', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total - PV-00169',
      generatedAt: new Date('2026-09-07T12:00:00-03:00'),
      mode: 'total',
      artisanalStrapRows: [{
        key: 'tira-cobre',
        groupName: 'TIRA OVERLOCK 5MM',
        color: 'COBRE',
        baseName: 'GLOW METALIC + MASSABOX',
        largura_mm: 5,
        metros_necessarios: 160,
        cut: {
          largura_mm: 5, metros_uteis_por_banda: 40, n_bandas: 4, cm_a_cortar: 2,
          rolos: 0.01, n_rolos_completos: 0, cm_no_ultimo_rolo: 2, valid: true, widthMissing: false,
        },
        canonical: {
          recipeId: 'recipe-cobre',
          baseRequiredM: 2.64,
          confirmedYieldMPerM: 60.6,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 60.6,
          transformationCostPerM: null,
          blockingReasons: [],
        },
      }],
      rows: [
        row({
          componentType: 'Cabedal',
          groupName: 'GLOW METALIC + MASSABOX',
          materialName: 'Cabedal',
          color: 'CHAMPAGNE',
          productUnit: 'm',
          totalQuantity: 15.39,
          available: 0,
          productIds: ['glow-champagne'],
        }),
        row({
          componentType: 'Cabedal',
          groupName: 'GLOW METALIC + MASSABOX',
          materialName: 'Cabedal',
          color: 'COBRE',
          productUnit: 'm',
          totalQuantity: 8.4,
          available: 0,
          productIds: ['glow-cobre'],
        }),
        row({
          componentType: 'Tiras',
          groupName: 'TIRA OVERLOCK 5MM',
          materialName: 'Produção interna',
          color: 'COBRE',
          productUnit: 'm',
          totalQuantity: 160,
          available: 0,
          productIds: ['tira-cobre'],
          artisanal: {
            baseName: 'GLOW METALIC + MASSABOX - COBRE',
            baseQty: 2.64,
            yieldPerMeter: 60.6,
          },
        }),
      ],
    });

    expect(html).toContain('GLOW METALIC + MASSABOX');
    // baseName da tira normaliza a cor fora da família §01.
    expect(html).not.toContain('GLOW METALIC + MASSABOX - COBRE');
    expect(html).toContain('Setor de Tiras');
    expect(html).toContain('2,64 m');
    expect((html.match(/class="napa-family-name"/g) || []).length).toBe(1);
    // Família = cabedal 15,39 + 8,40 = 23,79 (os 2,64 m da tira ficam no §03).
    expect(html).toMatch(/napa-family-qty">23,79 m</);
    expect(html).not.toContain('26,43');
    const totalsStrip = html.match(/<div class="totals-strip">[\s\S]*?<\/div>/)?.[0] || '';
    expect(totalsStrip).toContain('23,79');
    expect(html).toMatch(/<td>COBRE<\/td>[\s\S]*?8,40 m/);
  });

  it('grade do solado não quebra numeração/quantidade em células', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total — PV-00193',
      generatedAt: new Date('2026-09-07T13:58:00-03:00'),
      mode: 'total',
      artisanalStrapRows: [],
      rows: [
        row({
          componentType: 'Solado',
          groupName: 'SOLADO 01',
          materialName: '01',
          color: 'CARAMELO',
          productUnit: 'par',
          totalQuantity: 1800,
          soleProductId: 'sole-1',
          sizeBreakdown: {
            '34': 150, '35': 300, '36': 300, '37': 450, '38': 300, '39': 150, '40': 150,
          },
        }),
      ],
    });

    expect(html).toContain('white-space:nowrap');
    expect(html).toContain('>40</th>');
    expect(html).toContain('>150<');
    expect(html).toContain('>450<');
    // Não pode partir "40" em "4"+"0" nem "150" em "1"+"5"+"0".
    expect(html).not.toMatch(/<th class="grade-num">4<\/th>\s*<th class="grade-num">0<\/th>/);
    // Numerações com a MESMA largura. Com `table-layout:auto` (o mecanismo
    // antigo) o Chromium repartia a sobra por conteúdo e a grade 34–40 saía
    // com 39/40 espremidos no canto — regra de print 4, a grade manda.
    expect(html).toMatch(/\.sole-grade table \{[^}]*table-layout:fixed;/);
    expect(html).not.toMatch(/\.sole-grade table \{[^}]*table-layout:auto;/);
    // Só a 1ª coluna (o rótulo) tem largura fixa; as numerações dividem o
    // resto em partes iguais. `overflow:visible` garante que uma coluna
    // apertada TRANSBORDE em vez de cortar o número em silêncio.
    expect(html).toMatch(/\.sole-grade th:first-child \{[^}]*width:72px;/);
    expect(html).toMatch(/\.sole-grade th, \.sole-grade td \{[^}]*overflow:visible;/);
    expect(html).not.toMatch(/\.sole-grade (th|td)[^{]*\{[^}]*width:\d+%/);
  });

  it('row de corte sem linha de tira no pedido ainda aparece, com napa e sem mão de obra', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total - PV-00193',
      mode: 'total',
      artisanalStrapRows: [{
        key: 'tira-1',
        groupName: 'TIRA CHATA 8 mm · NAPA MADRID · OFF WHITE',
        color: 'OFF WHITE',
        baseName: 'NAPA MADRID',
        largura_mm: 8,
        metros_necessarios: 1044,
        cut: {
          largura_mm: 8, metros_uteis_por_banda: 0, n_bandas: 0, cm_a_cortar: 0,
          rolos: 0, n_rolos_completos: 0, cm_no_ultimo_rolo: 0, valid: false, widthMissing: false,
        },
        canonical: {
          recipeId: 'recipe-1',
          baseRequiredM: 14.91,
          confirmedYieldMPerM: 70,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 70,
          transformationCostPerM: 1.5,
          blockingReasons: [],
        },
      }],
      rows: [],
    });

    // Sem linha de tira no pedido, a row de corte entra como órfã — o antigo
    // §03 a mostrava, e sumir em silêncio seria perder napa de vista.
    expect(html).toContain('<span>Tiras · prestador');
    expect(html).toContain('Napa a enviar');
    expect(html).toContain('Tipo de tira / cor');
    expect(html).toContain('OFF WHITE');
    expect(html).toContain('1.044,00 m');
    expect(html).toContain('14,91 m');
    expect(html).toContain('flag ok');
    // baseName já está no typeName — não colar de novo (NAPA MADRIDNAPA MADRID).
    expect(html).not.toMatch(/NAPA MADRID<\/strong><small>NAPA MADRID<\/small>/);
    expect(html).not.toContain('Mão de obra/m');
    expect(html).not.toContain('Valor total');
    expect(html).not.toContain('receita conferida');
  });

  it('marca cadastro incompleto quando o rendimento da tira não está disponível', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total - PV-00193',
      mode: 'total',
      artisanalStrapRows: [{
        key: 'tira-sem-custo',
        groupName: 'ELÁSTICO FORRADO 7 mm · NAPA MADRID · CAPUCCINO',
        color: 'CAPUCCINO',
        baseName: 'NAPA MADRID',
        largura_mm: 7,
        metros_necessarios: 312,
        cut: {
          largura_mm: 7, metros_uteis_por_banda: 0, n_bandas: 0, cm_a_cortar: 0,
          rolos: 0, n_rolos_completos: 0, cm_no_ultimo_rolo: 0, valid: false, widthMissing: false,
        },
        canonical: {
          recipeId: 'recipe-2',
          baseRequiredM: 0,
          confirmedYieldMPerM: 0,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 30,
          transformationCostPerM: null,
          blockingReasons: [],
          snapshotWarning: 'A transformação física será congelada na primeira demanda.',
        },
      }],
      rows: [],
    });

    expect(html).toContain('<span>Tiras · prestador');
    expect(html).toContain('cadastro incompleto');
    expect(html).toContain('>312,00 m<');
    // Sem rendimento a napa é "—" — nunca um número inventado.
    expect(html).toMatch(/Napa a enviar<\/th>[\s\S]*?<span class="muted">—<\/span>/);
    expect(html).not.toContain('Mão de obra/m');
    expect(html).not.toContain('R$');
  });

  it('com rendimento confirmado, aviso soft de 1ª demanda mostra napa (não incompleto)', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total - PV-00222',
      mode: 'total',
      artisanalStrapRows: [{
        key: 'overlock-glow',
        groupName: 'TIRA OVERLOCK 5 mm · GLOW METALIC · CHAMPAGNE',
        color: 'CHAMPAGNE',
        baseName: 'GLOW METALIC',
        largura_mm: 5,
        metros_necessarios: 296.84,
        cut: {
          largura_mm: 5, metros_uteis_por_banda: 0, n_bandas: 0, cm_a_cortar: 0,
          rolos: 0, n_rolos_completos: 0, cm_no_ultimo_rolo: 0, valid: false, widthMissing: false,
        },
        canonical: {
          recipeId: 'recipe-overlock',
          baseRequiredM: 4.240571428571429,
          confirmedYieldMPerM: 70,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 70,
          transformationCostPerM: null,
          blockingReasons: [],
          snapshotWarning:
            'A versao, o rendimento e a necessidade de base serao congelados na primeira demanda; antes disso, apenas os IDs e o consumo tecnico do item estao preservados.',
        },
      }],
      rows: [],
    });

    expect(html).toContain('Setor de Tiras');
    expect(html).toContain('flag ok');
    expect(html).not.toContain('cadastro incompleto');
    expect(html).toContain('296,84 m');
    // Napa de tira com 4 casas: 296,84 ÷ 70 = 4,2406 m (2 casas fecharia errado).
    expect(html).toContain('4,2406 m');
  });

  it('desagrega por tipo × cor no bloco de prestador e um único total de napa no rodapé', () => {
    const cut = {
      largura_mm: 8, metros_uteis_por_banda: 0, n_bandas: 0, cm_a_cortar: 0,
      rolos: 0, n_rolos_completos: 0, cm_no_ultimo_rolo: 0, valid: false, widthMissing: false,
    };
    const makeRow = (
      key: string,
      segment: string,
      color: string,
      metros: number,
      baseRequiredM: number,
      largura_mm: number,
    ) => ({
      key,
      groupName: `${segment} · ${color}`,
      color,
      baseName: 'NAPA MADRID',
      largura_mm,
      metros_necessarios: metros,
      cut: { ...cut, largura_mm },
      canonical: {
        recipeId: `recipe-${key}`,
        baseRequiredM,
        confirmedYieldMPerM: 70,
        usableBaseWidthMm: 1370,
        theoreticalYieldMPerM: 70,
        transformationCostPerM: 0.32,
        blockingReasons: [] as string[],
      },
    });

    const elastico = 'ELÁSTICO FORRADO 7 mm · NAPA MADRID';
    const chata = 'TIRA CHATA 8 mm · NAPA MADRID';
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total - PV-00193',
      mode: 'total',
      artisanalStrapRows: [
        makeRow('e1', elastico, 'CAPUCCINO', 386.88, 12.9, 7),
        makeRow('e2', elastico, 'OFF WHITE', 386.88, 12.9, 7),
        makeRow('e3', elastico, 'ROCHA', 386.88, 12.9, 7),
        makeRow('c1', chata, 'CAPUCCINO', 1294.56, 18.49, 8),
        makeRow('c2', chata, 'OFF WHITE', 1294.56, 18.49, 8),
        makeRow('c3', chata, 'ROCHA', 1294.56, 18.49, 8),
      ],
      rows: [],
    });

    // Um rodapé por bloco, e desde 12/10/2026 um subtotal por TIPO (2 tipos).
    expect(html.match(/class="strap-grand"/g)).toHaveLength(1);
    expect(html.match(/class="strap-type"/g)).toHaveLength(2);
    expect(html).toContain('Total a mandar pro prestador');
    expect(html).toContain('Tipo de tira / cor');
    expect(html).toContain(elastico);
    expect(html).toContain(chata);
    expect(html).toContain('>CAPUCCINO<');
    expect(html).toContain('>OFF WHITE<');
    expect(html).toContain('>ROCHA<');
    expect(html).not.toContain('3 cores');
    // Quantidade por cor (não agregada por tipo)
    // Subtotal do tipo leva a unidade; a cor repete o número cru.
    expect(html).toContain('1.160,64 m');   // 3 × 386,88 (elástico)
    expect(html).toContain('3.883,68 m');   // 3 × 1.294,56 (chata)
    expect(html).toContain('>386,88</td>');
    expect(html).toContain('>1.294,56</td>');
    expect(html).toContain('12,90 m');
    expect(html).toContain('18,49 m');
    // Totais no rodapé: 6 × cores somadas
    expect(html).toContain('5.044,32 m tira');
    expect(html).toContain('94,17 m');
    expect(html).not.toContain('Mão de obra/m');
  });


  it('mostra custo/un e custo total por material e cor no Consumo total', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total - PV-00193',
      mode: 'total',
      artisanalStrapRows: [],
      rows: [
        row({
          componentType: 'Cabedal',
          groupName: 'NAPA MADRID',
          materialName: 'Cabedal',
          color: 'OFF WHITE',
          productUnit: 'm',
          totalQuantity: 14.91,
          unitPrice: 12.5,
          productIds: ['napa-madrid-off'],
        }),
        row({
          componentType: 'Embalagem',
          groupName: 'EMBALAGEM',
          materialName: 'CAIXA COLMEIA 11',
          color: '—',
          productUnit: 'un',
          totalQuantity: 45,
          unitPrice: 4,
          boxTypeIds: ['bt-colmeia'],
        }),
        row({
          componentType: 'Solado',
          groupName: 'SOLADO 01',
          materialName: 'Solado',
          color: 'PRETO',
          productUnit: 'par',
          totalQuantity: 1800,
          unitPrice: 1.9,
          productIds: ['solado-01-preto'],
        }),
      ],
    });

    expect(html).toContain('Preço/un.');
    expect(html).toContain('A gastar');
    expect(html).toContain('Total a gastar');
    expect(html).toContain('NAPA MADRID');
    expect(html).toContain('OFF WHITE');
    expect(html).toContain('R$\u00a012,50');
    expect(html).toContain('R$\u00a0186,38');
    expect(html).toContain('R$\u00a04,00');
    expect(html).toContain('R$\u00a0180,00');
    // Valor a gastar completo (necessidade × unitário) — não cortado no markup
    expect(html).toContain('R$\u00a03.420,00');
    // Soma do manifesto: 186,38 + 180,00 + 3.420,00 = 3.786,38
    expect(html).toContain('R$\u00a03.786,38');
    expect(html).toContain('class="num cost-spend"');
    expect(html).toContain('class="num cost-unit"');
    expect(html).toContain('--spend:');

    // Layout: "A gastar" precisa de largura e alinhamento à direita — a regra
    // de 2026-08 dava 8%+center. A largura saiu do CSS e virou inline no
    // `<th>`: Aplicação e Cor somem no bloco que as deixaria vazias, então
    // `nth-child(7)` passou a apontar para colunas diferentes em cada bloco.
    expect(html).toMatch(/<th class="num col-spend c-spend" style="width:\d+\.\d\d%">A gastar<\/th>/);
    expect(html).toMatch(/\.materials-table th\.c-spend \{ text-align:right; \}/);
    expect(html).not.toMatch(/\.materials-table[^{]*th:nth-child\(\d\)/);
    // Cada bloco fecha 100%: `table-layout:fixed` com soma menor estica a
    // última coluna e com soma maior corta número (regra de print 4).
    for (const head of html.match(/<thead><tr><th class="c-group"[\s\S]*?<\/tr><\/thead>/g) || []) {
      const widths = [...head.matchAll(/style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
      expect(widths.length).toBeGreaterThanOrEqual(5);
      expect(Math.abs(widths.reduce((a, b) => a + b, 0) - 100)).toBeLessThan(0.1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Decisões do dono de 11/10/2026, travadas pelo PV-00195:
//  (1) a napa das tiras fica SÓ no §03 Setor de Tiras — fora de todo total;
//  (2) no §02 a tira é só o total por TIPO × COR (sem metros por numeração,
//      sem pares, sem "enviar ao prestador").
// ═══════════════════════════════════════════════════════════════════════════
describe('PV-00195 · napa de tira só no §03', () => {
  const build = (mode: 'coverage' | 'total' = 'coverage') => buildMaterialConsumptionReportHtml({
    title: 'Consumo de Materiais — PV-00195',
    generatedAt: new Date('2026-10-11T10:00:00-03:00'),
    rows: PV00195_ROWS,
    artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    mode,
  });

  it.each(['coverage', 'total'] as const)('KPI, §01 e "Necessidade total" caem de 78,09 m para 55,57 m (%s)', (mode) => {
    const html = build(mode);
    const manifest = between(html, 'class="manifest', '</div>\n  </div>');
    expect(manifest).toContain('55,57 m');
    expect(manifest).toContain('cabedal + forração · napa das tiras no bloco de prestador');
    expect(manifest).not.toContain('tiras convertidas');
    expect(html).not.toContain('78,09');

    const totalsStrip = html.match(/<div class="totals-strip">[\s\S]*?<\/div>/)?.[0] || '';
    expect(totalsStrip).toContain('55,57');

    const s01 = between(html, '<h2>Necessidade de napa</h2>', 'Materiais por aplicação');
    expect(s01).toMatch(/napa-family-name">GLOW METALIC<\/span>[\s\S]*?napa-family-qty">28,12 m</);
    // Família de UMA aplicação (GLOW METALIC = só cabedal): a coluna da
    // aplicação repetiria o Total e a outra sairia "—" em toda linha, então
    // as duas somem e fica Cor | Total.
    expect(s01).toMatch(/<td>CHAMPAGNE<\/td>\s*<td class="num strong">14,06 m<\/td>/);
    expect(s01).not.toContain('app-qty');
    expect(s01).not.toMatch(/<th class="num">(Cabedal|Forração)<\/th>/);
    expect(s01).toMatch(/<td>COBRE<\/td>[\s\S]*?<td class="num strong">14,06 m<\/td>/);
    expect(s01).toMatch(/<td>OFF WHITE<\/td>[\s\S]*?<td class="num strong">14,06 m<\/td>/);
    // Nem os valores antigos, nem a tabela de tira pendente, nem a coluna Situação.
    for (const old of ['32,74', '16,70', '15,26', 'rendimento pendente', 'Situação']) {
      expect(s01).not.toContain(old);
    }
    expect(s01).toContain('A napa das tiras está só no bloco Tiras · prestador.');

    if (mode === 'coverage') {
      const reading = between(html, '<h3>Leitura correta</h3>', '</p>');
      expect(reading).toContain('soma cabedal (+ fachete) e forração; a napa das tiras está no bloco Tiras · prestador');
      expect(reading).not.toContain('tiras convertidas');
    } else {
      // No total a caixa saiu: era repetição full-width da tarja + das notas
      // das duas seções. A origem da napa continua escrita, ao lado do título.
      expect(html).not.toContain('<h3>Leitura correta</h3>');
      expect(html).toContain('Consumo total · estoque ignorado · necessidade bruta do pedido');
      expect(s01).toContain('A napa das tiras está só no bloco Tiras · prestador.');
      expect(section02(html)).toContain('a napa delas está no bloco de prestador');
    }
    expect(html).not.toContain('tiras convertidas');
  });

  it('o bloco de prestador continua mostrando a napa (22,52 m) por tipo × cor', () => {
    const s03 = strapBlock(build(), 'prestador');
    expect(s03).toContain('Total a mandar pro prestador');
    expect(s03).toContain('22,52 m');
    expect(s03).toContain('12,24 m'); // overlock champagne 856,80 ÷ 70
    expect(s03).toContain('6,44 m'); // elástico champagne 193,20 ÷ 30
    expect(s03).toContain('2,64 m'); // overlock cobre 184,80 ÷ 70
    expect(s03).toContain('1,20 m'); // chata off white 84,00 ÷ 70
  });

  it('Maiores faltas não somam a napa da tira no balde da napa', () => {
    const html = build();
    const faltas = between(html, '<h3>Maiores faltas</h3>', '</ol>');
    expect(faltas).toMatch(/GLOW METALIC · CHAMPAGNE<\/span><strong>14,06 m<\/strong>/);
    expect(faltas).not.toContain('32,74');
  });
});

describe('PV-00195 · bloco Tiras do §02 = total por tipo × cor', () => {
  it('agrega todas as linhas da ficha em 6 linhas — OVERLOCK CHAMPAGNE 4 linhas → 856,80', () => {
    const lines = aggregateStrapTypeColorLines(PV00195_ROWS);
    expect(lines.map((line) => [line.typeName, line.color, line.origin, Number(line.total.toFixed(2))]))
      .toEqual([
        ['ELÁSTICO FORRADO 7 mm · GLOW METALIC', 'CHAMPAGNE', 'fazer', 193.2],
        ['TIRA CHATA 8 mm · NAPA SOFT', 'OFF WHITE', 'fazer', 84],
        ['TIRA OVERLOCK 5 mm · GLOW METALIC', 'CHAMPAGNE', 'fazer', 856.8],
        ['TIRA OVERLOCK 5 mm · GLOW METALIC', 'COBRE', 'fazer', 184.8],
        ['TIRA STRASS 6MM', 'CRISTAL C/ FUNDO BRANCO', 'comprar', 319.2],
        ['TIRA STRASS 6MM', 'ROSADO C/ FUNDO ROSADO', 'comprar', 210],
      ]);
    const champagne = lines.find((line) => line.typeName.includes('OVERLOCK') && line.color === 'CHAMPAGNE')!;
    expect(champagne.rows).toHaveLength(4);
    expect(champagne.total).toBeCloseTo(218.4 + 218.4 + 218.4 + 201.6, 9);
  });

  it('imprime só tipo, cor, origem e total — sem metros por numeração, pares ou napa', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows: PV00195_ROWS,
      artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    });
    const s02 = section02(html);
    // Os 6 pares tipo × cor continuam — agora como 4 linhas de TIPO (que já
    // são o subtotal) mais 6 linhas de COR, repartidas por origem.
    expect(strapColorRows(html, 'comprar pronto')).toHaveLength(2);
    expect(strapColorRows(html, 'prestador')).toHaveLength(4);
    expect(strapTypeRows(html, 'comprar pronto')).toHaveLength(1);
    expect(strapTypeRows(html, 'prestador')).toHaveLength(3);
    // O strass não tem seção própria: é um tipo dentro do bloco de compra.
    expect(s02).not.toContain('<span>Tira Strass</span>');
    expect(s02).toContain('<span>Tiras · comprar pronto</span>');

    const overlock = strapTypeRows(html, 'prestador')
      .find((tr) => tr.includes('TIRA OVERLOCK 5 mm · GLOW METALIC</strong>'))!;
    // CHAMPAGNE e COBRE são o MESMO tipo: o subtotal soma as duas cores.
    expect(overlock).toContain('<td class="num strong">1.041,60 m</td>');
    expect(strapColorRows(html, 'prestador').join('')).toContain('>856,80</td>');
    // Sem coluna de dinheiro no prestador: `spend` é null por construção lá.
    expect(strapBlock(html, 'prestador')).not.toContain('cost-spend');

    // O tipo TIRA STRASS 6MM soma as duas cores no subtotal; cada cor mantém
    // o seu número, estoque e falta na própria linha.
    const strassType = strapTypeRows(html, 'comprar pronto')[0];
    expect(strassType).toContain('<td><strong>TIRA STRASS 6MM</strong>');
    expect(strassType).toContain('<td class="num strong">529,20 m</td>'); // 319,20 + 210,00
    expect(strassType).toContain('R$\u00a01.323,00');
    const buyColors = strapColorRows(html, 'comprar pronto');
    const cristal = buyColors.find((tr) => tr.includes('<td>CRISTAL C/ FUNDO BRANCO</td>'))!;
    expect(cristal).toContain('<td class="num">319,20</td>');
    // Duas linhas da ficha no MESMO SKU: estoque 100 entra uma vez → falta 219,20.
    expect(cristal).toContain('<td class="num">100,00</td>');
    expect(cristal).toContain('<td class="num shortage">219,20</td>');
    expect(cristal).toContain('R$\u00a0798,00');
    const rosado = buyColors.find((tr) => tr.includes('<td>ROSADO C/ FUNDO ROSADO</td>'))!;
    expect(rosado).toContain('<td class="num">210,00</td>');
    expect(rosado).toContain('R$\u00a0525,00');

    // Tipos de uma cor só: o subtotal e a cor trazem o mesmo número.
    const makeTypes = strapTypeRows(html, 'prestador').join('');
    const makeColors = strapColorRows(html, 'prestador').join('');
    for (const [type, color, total] of [
      ['ELÁSTICO FORRADO 7 mm · GLOW METALIC', 'CHAMPAGNE', '193,20'],
      ['TIRA CHATA 8 mm · NAPA SOFT', 'OFF WHITE', '84,00'],
    ]) {
      expect(makeTypes, type).toContain(`${type}</strong>`);
      expect(makeTypes, type).toContain(`<td class="num strong">${total} m</td>`);
      expect(makeColors, color).toContain(`<td>${color}</td>`);
    }
    expect(makeColors).toContain('>184,80</td>'); // OVERLOCK COBRE, sob o tipo

    // Nada do que o dono mandou tirar do §02.
    expect(s02).not.toMatch(/\b3[4-9]: [\d.,]+ m/); // metros por numeração
    expect(s02).not.toContain('pares');
    expect(s02).not.toContain('enviar ao prestador');
    expect(s02).not.toContain('napa GLOW METALIC');
    expect(s02).not.toContain('Prestador · TIRA');
    expect(s02).not.toContain('m de tira');
    // Sem espaço morto: nenhum dos dois blocos tem Aplicação, Un. ou Preço/un.
    for (const kind of ['comprar pronto', 'prestador'] as const) {
      const block = strapBlock(html, kind);
      expect(block, kind).not.toContain('Aplicação');
      expect(block, kind).not.toContain('Preço/un.');
      expect(block, kind).not.toContain('<th>Un.</th>');
    }
  });

  it('total a gastar soma o strass uma vez só (798,00 + 525,00)', () => {
    expect(computeMaterialsSpendTotal(PV00195_ROWS)).toBeCloseTo(319.2 * 2.5 + 210 * 2.5, 6);
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows: PV00195_ROWS,
      artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    });
    expect(html).toContain('<dd class="spend">R$\u00a01.323,00</dd>');
  });

  it('modo consumo total: sem Estoque/Falta no bloco, mantém Origem e A gastar', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total — PV-00195',
      rows: PV00195_ROWS,
      artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
      mode: 'total',
    });
    const buy = strapBlock(html, 'comprar pronto');
    expect(buy).toContain('straps-table total-mode');
    expect(buy).toContain('A gastar');
    expect(buy).not.toContain('Estoque');
    expect(buy).not.toContain('Falta');
    const make = strapBlock(html, 'prestador');
    expect(make).toContain('Napa a enviar');
    expect(make).not.toContain('Estoque');
    expect(make).not.toContain('A gastar');
    expect(strapColorRows(html, 'comprar pronto')).toHaveLength(2);
    expect(strapColorRows(html, 'prestador')).toHaveLength(4);
  });

  it('não reduz fonte: o bloco usa as classes e corpos de texto que o documento já tinha', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows: PV00195_ROWS,
      artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    });
    expect(html).toContain('.report-table th { padding:5px 4px;');
    expect(html).toContain('font-size:6.5pt');
    expect(html).toMatch(/body \{ font: 9\.2pt\/1\.32 'Fira Sans'/);
    // Nenhuma regra nova de fonte para o bloco de tiras.
    expect(html).not.toMatch(/\.straps-table[^{]*\{[^}]*font-size/);
  });

  it('larguras do bloco Tiras: número de 4–5 dígitos cabe na coluna (regra de print 4)', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows: PV00195_ROWS,
      artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    });
    // As larguras saíram do CSS para o `<th>`: a mesma classe .straps-table
    // serve a tabelas de 3 a 6 colunas (comprar/prestador × total/cobertura),
    // então nth-child apontaria para a coluna errada em metade dos casos.
    const widthsOf = (block: string): number[] =>
      [...block.matchAll(/<th[^>]*style="width:(\d+)%"/g)].map((m) => Number(m[1]));
    const totalHtml = buildMaterialConsumptionReportHtml({
      title: 'Consumo total — PV-00195', mode: 'total',
      rows: PV00195_ROWS, artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    });
    for (const [label, block, floors] of [
      // [rótulo, bloco, piso de cada coluna a partir da 2ª]
      ['cobertura · comprar', strapBlock(html, 'comprar pronto'), [15, 12, 12, 14]],
      ['cobertura · prestador', strapBlock(html, 'prestador'), [13, 11, 11, 11, 0]],
      ['total · comprar', strapBlock(totalHtml, 'comprar pronto'), [20, 14]],
      ['total · prestador', strapBlock(totalHtml, 'prestador'), [17, 11, 0]],
    ] as [string, string, number[]][]) {
      const widths = widthsOf(block);
      // `table-layout:fixed` com soma ≠ 100 estica ou corta a última coluna.
      expect(widths.reduce((a, b) => a + b, 0), `${label}: soma`).toBe(100);
      // "TIRA OVERLOCK 5 mm · GLOW METALIC" numa linha só.
      expect(widths[0], `${label}: tipo`).toBeGreaterThanOrEqual(31);
      // Colunas de número: "12.852,00" pede ~10% da tabela. A 8% o valor
      // invadia a coluna vizinha (medido em 11/10/2026).
      floors.forEach((floor, i) => {
        expect(widths[i + 1], `${label}: coluna ${i + 2}`).toBeGreaterThanOrEqual(floor);
      });
    }
  });

  it('tipo de tira sai em caixa alta, qualquer que seja o nome do SKU', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows: PV00195_ROWS,
      artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    });
    // Prestador chega "TIRA OVERLOCK 5 mm · GLOW METALIC" e strass
    // "Tira Strass 6mm": sem isto a mesma tabela tem duas convenções.
    expect(html).toContain('.straps-table td:first-child strong { text-transform:uppercase; }');
  });

  it('o cabeçalho do bloco não fica órfão no pé da folha', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows: PV00195_ROWS,
      artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    });
    // Sem `break-after:avoid` o browser quebra entre o cabeçalho e a tabela,
    // deixando "TIRAS · N LINHA(S)" sozinho numa caixa vazia.
    expect(html).toMatch(/\.component-heading \{[^}]*break-after:avoid;/);
  });

  it('sem tira de Prestador o documento não aponta para o §03', () => {
    const semPrestador = PV00195_ROWS.filter((row) => !row.artisanal);
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows: semPrestador,
      artisanalStrapRows: [],
    });
    expect(html).not.toContain('§03');
    expect(html).toContain('Necessidade de napa (§01) soma cabedal (+ fachete) e forração.');
    // Com tira de Prestador a referência volta.
    const comPrestador = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows: PV00195_ROWS,
      artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    });
    expect(comPrestador).toContain('bloco Tiras · prestador');
  });

  it('o cabeçalho "Total (m)" não vira "TOTAL (M)" no uppercase do thead', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows: PV00195_ROWS,
      artisanalStrapRows: PV00195_STRAP_CUT_ROWS,
    });
    expect(html).toMatch(/<th class="num"[^>]*>Total<span class="unit-suffix"> \(m\)<\/span><\/th>/);
    expect(html).toContain('.report-table th .unit-suffix { text-transform:none; }');
  });

  it('modo por PV e modelo: a agregação tipo × cor vale dentro de cada modelo', () => {
    const tag = (row: ConsumptionRow, ref: string): ConsumptionRow => ({
      ...row, orderNumber: 'PV-00195', saleOrderId: 'pv-195', referenceCode: ref, referenceId: `ref-${ref}`,
    } as ConsumptionRow);
    const overlock = PV00195_ROWS.filter((row) => row.groupName.startsWith('TIRA OVERLOCK 5 mm · GLOW METALIC · CHAMPAGNE'));
    const rows = [
      // I704: TIRA 1–3 · I705: TIRA 4 — mesmo tipo × cor em modelos diferentes.
      ...overlock.slice(0, 3).map((row) => tag(row, 'I704')),
      tag(overlock[3], 'I705'),
    ];
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00195',
      rows,
      artisanalStrapRows: [],
      mode: 'total',
      partitionMode: 'order_reference',
    });
    const i704 = between(html, '>I704</h3>', '</table>');
    const i705 = html.slice(html.indexOf('>I705</h3>'));
    expect(i704).toContain('<td class="num strong">655,20 m</td>'); // 3 × 218,40
    expect(i705).toContain('<td class="num strong">201,60 m</td>');
    expect(html).not.toContain('856,80');
  });
});

describe('bloco Tiras do §02 · pendência e origem', () => {
  it('linha com pendência mantém ▲ e is-pending; Prestador e Comprar do mesmo tipo × cor não se misturam', () => {
    const base = {
      componentType: 'Tiras', groupName: 'TIRA CHATA 8 mm · NAPA SOFT · PRETO', color: 'PRETO',
      productUnit: 'm', available: 0,
    };
    const lines = aggregateStrapTypeColorLines([
      { ...base, materialName: 'Prestador · TIRA 1', totalQuantity: 10, productIds: ['chata-preto'],
        artisanal: { baseName: 'NAPA SOFT', baseQty: 0, yieldPerMeter: 0, pending: true, blockedReason: 'Sem receita aprovada.' } },
      { ...base, materialName: 'Prestador · TIRA 2', totalQuantity: 5, productIds: ['chata-preto'],
        artisanal: { baseName: 'NAPA SOFT', baseQty: 5 / 70, yieldPerMeter: 70 } },
      { ...base, materialName: 'Comprar pronto', totalQuantity: 7, productIds: ['chata-preto-pronta'],
        strapSourceMode: 'buy_ready' },
    ] as ConsumptionRow[]);
    expect(lines.map((line) => [line.origin, line.total])).toEqual([['comprar', 7], ['fazer', 15]]);
    const fazer = lines.find((line) => line.origin === 'fazer')!;
    expect(fazer.pending).toBe(true);
    expect(fazer.warnings).toEqual(['Sem receita aprovada.']);

    const html = buildMaterialConsumptionReportHtml({
      title: 'PV',
      rows: [
        row({ ...base, materialName: 'Prestador · TIRA 1', totalQuantity: 10, warning: 'Sem receita aprovada.',
          artisanal: { baseName: 'NAPA SOFT', baseQty: 0, yieldPerMeter: 0, pending: true } }),
      ],
      artisanalStrapRows: [],
    });
    const [tr] = strapBlockRows(html);
    expect(tr).toContain('is-pending');
    expect(tr).toContain('<div class="row-warning">▲ Sem receita aprovada.</div>');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Densidade do documento (12/10/2026) — "densidade vem de tirar espaço morto,
// nunca de reduzir fonte" (Preferências de impressão, CLAUDE.md). O que estes
// testes travam é o ESPAÇO, não o conteúdo: nenhum número saiu do documento.
// ═══════════════════════════════════════════════════════════════════════════
describe('§02 · coluna só existe se alguma linha do bloco a preenche', () => {
  const blockOf = (html: string, componentType: string): string => between(
    html,
    `<span>${componentType}</span>`,
    '</table>',
  );

  const html = () => buildMaterialConsumptionReportHtml({
    title: 'Consumo de Materiais — densidade',
    generatedAt: new Date('2026-10-12T14:01:00-03:00'),
    mode: 'total',
    artisanalStrapRows: [],
    rows: [
      // Cabedal: tem cor E aplicação própria — mantém as duas colunas.
      row({
        componentType: 'Cabedal', groupName: 'NAPA SOFT', materialName: 'Cabedal',
        color: 'OFF WHITE', productUnit: 'm', totalQuantity: 6.19, unitPrice: 17.34,
      }),
      // Colas: `materialName === groupName` e sem cor — as duas colunas somem.
      row({
        componentType: 'Item padrão (solado)', groupName: 'COLA PVC', materialName: 'COLA PVC',
        color: '', productUnit: 'kg', totalQuantity: 9.5, unitPrice: 17.9946,
      }),
      row({
        componentType: 'Item padrão (solado)', groupName: 'COLA FORTE', materialName: 'COLA FORTE',
        color: '', productUnit: 'kg', totalQuantity: 7.39, unitPrice: 18.21,
      }),
    ],
  });

  it('bloco sem cor nenhuma não imprime a coluna Cor', () => {
    const colas = blockOf(html(), 'Item padrão (solado)');
    expect(colas).not.toContain('<th class="c-color"');
    expect(colas).toContain('COLA PVC');
    expect(colas).toContain('R$ 170,95');
    // E o bloco que TEM cor continua com ela.
    expect(blockOf(html(), 'Cabedal')).toContain('>Cor</th>');
    expect(blockOf(html(), 'Cabedal')).toContain('OFF WHITE');
  });

  it('não repete o Grupo na Aplicação — "COLA PVC" ao lado de "COLA PVC"', () => {
    const colas = blockOf(html(), 'Item padrão (solado)');
    expect(colas).not.toContain('<th class="c-app"');
    expect(colas.match(/COLA PVC/g)).toHaveLength(1);
    // Aplicação que acrescenta informação continua impressa.
    expect(blockOf(html(), 'Cabedal')).toMatch(/<th class="c-app"[^>]*>Aplicação<\/th>/);
  });

  it('a grade do solado ocupa a largura real do bloco (colspan segue as colunas)', () => {
    const doc = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — grade', mode: 'total', artisanalStrapRows: [],
      rows: [row({
        componentType: 'Solado', groupName: 'SOLADO 01', materialName: '01', color: 'CARAMELO',
        productUnit: 'par', totalQuantity: 492, soleProductId: 's1',
        sizeBreakdown: { 34: 41, 35: 82, 36: 82, 37: 123, 38: 82, 39: 41, 40: 41 },
      })],
    });
    const block = between(doc, '<span>Solado</span>', '</table>');
    // Só o thead do bloco — a sub-tabela da grade tem <th> próprios.
    const colCount = (between(block, '<thead>', '</thead>').match(/<th[ >]/g) || []).length;
    // Grupo · Aplicação ("01") · Cor (CARAMELO) · Necessidade · Un. · Preço · A gastar.
    expect(colCount).toBe(7);
    expect(block).toContain(`<td colspan="${colCount}">`);
  });
});

describe('célula de tabela: <small> é segunda LINHA, nunca colado no texto', () => {
  it('o setor que consome não cola no nome da aplicação', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — setor', mode: 'total', artisanalStrapRows: [],
      rows: [row({
        componentType: 'Componente Direto', groupName: 'ELÁSTICO 7MM', materialName: 'Elástico 6MM',
        color: 'PRETO', productUnit: 'm', totalQuantity: 62.4, unitPrice: 1,
        consumptionSector: 'Aviamento',
      })],
    });
    // Os dois textos existem, um em cada linha…
    expect(html).toContain('Elástico 6MM<small>Aviamento: 62,40 m</small>');
    // …e o CSS garante que o <small> da célula quebra linha. Sem esta regra o
    // papel saía "Elástico 6MMAviamento: 62,40 m" (medido 12/10/2026).
    expect(html).toMatch(/\.report-table td small \{[^}]*display:block;/);
  });
});

describe('§01 · colunas de aplicação só quando a família MISTURA as duas', () => {
  const build = (rows: ConsumptionRow[]) => buildMaterialConsumptionReportHtml({
    title: 'Consumo de Materiais — napa', mode: 'total', artisanalStrapRows: [], rows,
  });
  const s01 = (html: string) => between(html, '<h2>Necessidade de napa</h2>', 'Materiais por aplicação');

  const cabedal = row({
    componentType: 'Cabedal', groupName: 'NAPA SOFT', materialName: 'Cabedal',
    color: 'OFF WHITE', productUnit: 'm', totalQuantity: 6.19,
  });
  const forracao = row({
    componentType: 'Forração', groupName: 'NAPA SOFT', materialName: 'Forração',
    color: 'PRETO', productUnit: 'm', totalQuantity: 1.69,
  });

  it('família com as duas aplicações mantém Cabedal e Forração', () => {
    const block = s01(build([cabedal, forracao]));
    expect(block).toContain('<th class="num">Cabedal</th>');
    expect(block).toContain('<th class="num">Forração</th>');
    expect(block).toContain('app-qty');
  });

  it('família de uma aplicação só fica com Cor | Total', () => {
    // `qty` é exatamente cabedal + forração: com uma aplicação, a coluna dela
    // repete o Total e a outra é "—" em toda linha.
    const block = s01(build([cabedal]));
    expect(block).not.toContain('<th class="num">Cabedal</th>');
    expect(block).not.toContain('<th class="num">Forração</th>');
    expect(block).not.toContain('app-qty');
    expect(block).toContain('6,19 m');
  });
});

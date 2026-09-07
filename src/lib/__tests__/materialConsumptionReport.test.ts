import { describe, expect, it } from 'vitest';
import { buildMaterialConsumptionReportHtml, materialConsumptionReportFilename } from '@/lib/materialConsumptionReport';
import type { ConsumptionRow } from '@/lib/consumptionRows';

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

  it('não publica metro de tira artesanal como falta de compra nem no total em m', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo de Materiais — PV-00168',
      generatedAt: new Date('2026-08-30T15:11:00-03:00'),
      artisanalStrapRows: [],
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

    // §01 traz a tira como metro de napa; §02 não repete 1.402 m de tira.
    expect(html).toContain('prod. interna');
    expect(html).toContain('20,04 m');
    expect(html).not.toContain('class="num shortage">1.402,80');
    expect(html).not.toContain('>1.402,80<');
    const totalsStrip = html.match(/<div class="totals-strip">[\s\S]*?<\/div>/)?.[0] || '';
    expect(totalsStrip).toContain('40,25');
    expect(totalsStrip).not.toContain('1.402,80');
    expect(html).toContain('metro de napa');
    expect(html).toContain('>Cabedal<');
    expect(html).toContain('>Forração<');
    expect(html).toContain('>Tira<');
    expect(html).toContain('20,21 m');
    expect(html).toContain('40,25 m');
    expect(html).not.toContain('<span>Tiras</span>');
  });

  it('no modo consumo total ignora estoque e agrupa napa por família e cor', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total — PV-00168',
      generatedAt: new Date('2026-08-30T15:11:00-03:00'),
      mode: 'total',
      artisanalStrapRows: [],
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
    expect(html).toContain('20,21 m');
    expect(html).toContain('20,04 m');
    expect(html).toContain('40,25 m');
    expect(html).not.toContain('Itens em falta');
    expect(html).not.toContain('Maiores faltas');
    expect(html).not.toContain('>Estoque<');
    expect(html).not.toContain('>Falta<');
    expect(html).toContain('Necessidade');
    expect(html).not.toContain('>1.402,80<');
  });

  it('PV-00193: strip de metros ignora tira pending e §02 não lista metros de tira', () => {
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
    expect(totalsStrip).toContain('129,18');
    expect(totalsStrip).not.toContain('1.173,21');
    expect(totalsStrip).not.toContain('1.044,00');
    expect(html).toContain('Tira com cadastro pendente');
    expect(html).toContain('pending-strip');
    expect(html).toContain('129,18 m');
    // Pending aparece na §02 como cadastro incompleto (demanda da ficha).
    expect(html).toContain('<span>Tiras</span>');
    expect(html).toContain('Tira sem cadastro');
    expect(html).toContain('is-pending');
  });

  it('não cria bloco separado quando a tira traz SKU Massabox com cor (PV-00169)', () => {
    const html = buildMaterialConsumptionReportHtml({
      title: 'Consumo total - PV-00169',
      generatedAt: new Date('2026-09-07T12:00:00-03:00'),
      mode: 'total',
      artisanalStrapRows: [],
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
    expect(html).not.toContain('GLOW METALIC + MASSABOX - COBRE');
    expect(html).toContain('2,64 m');
    expect(html).toContain('prod. interna');
    // Um único bloco de família: cabedal champagne + cabedal cobre + tira cobre.
    expect((html.match(/class="napa-family-name"/g) || []).length).toBe(1);
    expect(html).toContain('26,43 m');
    // Cobre da tira entra na mesma linha de cor do cabedal Massabox.
    expect(html).toMatch(/<td>COBRE<\/td>[\s\S]*?8,40 m[\s\S]*?2,64 m<small>prod\. interna<\/small>[\s\S]*?11,04 m/);
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
    expect(html).toContain('table-layout:auto');
    expect(html).toContain('>40</th>');
    expect(html).toContain('>150<');
    expect(html).toContain('>450<');
    // Não pode partir "40" em "4"+"0" nem "150" em "1"+"5"+"0".
    expect(html).not.toMatch(/<th class="grade-num">4<\/th>\s*<th class="grade-num">0<\/th>/);
  });

  it('mostra mão de obra/m e valor total nas tiras artesanais', () => {
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

    expect(html).toContain('Mão de obra/m');
    expect(html).toContain('Valor total');
    expect(html).toContain('R$\u00a01,50');
    expect(html).toContain('R$\u00a01.566,00');
    expect(html).toContain('receita conferida');
  });

  it('mostra traço quando o custo de mão de obra da tira não está disponível', () => {
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
          baseRequiredM: 10.4,
          confirmedYieldMPerM: 30,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 30,
          transformationCostPerM: null,
          blockingReasons: [],
        },
      }],
      rows: [],
    });

    expect(html).toContain('Mão de obra/m');
    expect(html).toContain('Valor total');
    // Duas células "—" para unitário e total (além de não inventar R$).
    expect(html).toMatch(/Mão de obra\/m[\s\S]*?<td class="num">—<\/td>\s*<td class="num strong">—<\/td>/);
    expect(html).not.toContain('R$');
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
      ],
    });

    expect(html).toContain('Preço unitário');
    expect(html).toContain('Valor a gastar');
    expect(html).toContain('NAPA MADRID');
    expect(html).toContain('OFF WHITE');
    expect(html).toContain('R$\u00a012,50');
    expect(html).toContain('R$\u00a0186,38');
    expect(html).toContain('R$\u00a04,00');
    expect(html).toContain('R$\u00a0180,00');
  });
});

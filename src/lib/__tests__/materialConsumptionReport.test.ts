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
    expect(html).toContain('Materiais por setor');
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
});

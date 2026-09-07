import { describe, expect, it } from 'vitest';
import { normalizeDirectComponentSectors } from '@/lib/consumptionSector';
import { adaptCanonicalConsumptionLines, validateCanonicalConsumptionReport } from '@/lib/canonicalConsumptionReport';
import { aggregateConsumption, filterConsumptionForSector, toBulkConsumptionRow } from '@/hooks/useBulkOrderConsumption';
import { buildMaterialConsumptionReportHtml } from '@/lib/materialConsumptionReport';

const id = '11111111-1111-4111-8111-111111111111';
const line = (sector: string | null, required: number) => ({
  line_kind: 'material', scope_key: id, scope_type: 'production_order',
  sale_order_id: id, sale_order_item_id: id, reference_id: id,
  quantity: 100, effective_grade: { '34': 100 }, component: 'Componente Direto',
  product_id: id, product_name: 'BINÓCULO 6MM', product_unit: 'un',
  required, consumption_sector: sector, consumption_sector_source: sector ? 'snapshot' : null,
});
const adapt = (...lines: ReturnType<typeof line>[]) => adaptCanonicalConsumptionLines(
  validateCanonicalConsumptionReport({ version: 1, engine: 'calculate_order_consumption_by_grade',
    lines, strap_previews: [] }).lines,
);

describe('setor de consumo — cadastro → relatório → ficha', () => {
  it('persiste o padrão visível sem alterar quantidade, unidade ou produto', () => {
    const original = [{ product_id: id, quantity: 4, unit: 'un' },
      { product_id: id, quantity: 2, unit: 'un', consumption_sector: ' Solagem ' }];
    expect(normalizeDirectComponentSectors(original)).toEqual([
      { ...original[0], consumption_sector: 'Aviamento' },
      { ...original[1], consumption_sector: 'Solagem' },
    ]);
    expect(original[0]).not.toHaveProperty('consumption_sector');
    expect(normalizeDirectComponentSectors(null)).toEqual([]);
  });

  it('não agrega obrigações do mesmo produto em setores diferentes', () => {
    const rows = adapt(line('Aviamento', 100), line('Aviamento', 50), line('Solagem', 250));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.consumptionSector, row.totalQuantity])).toEqual([
      ['Aviamento', 150], ['Solagem', 250],
    ]);
    expect(rows.every((row) => row.consumptionSectorSource === 'snapshot')).toBe(true);
    expect(rows.reduce((total, row) => total + row.totalQuantity, 0)).toBe(4 * 100);
  });

  it('respeita o destino explícito mesmo quando o nome sugere outro setor', () => {
    const rows = adapt(line('Solagem', 400)).map(toBulkConsumptionRow);
    expect(rows[0].component).toBe('Componente Direto');
    expect(filterConsumptionForSector(rows, 'Aviamento')).toEqual([]);
    expect(filterConsumptionForSector(rows, 'Solagem')).toEqual(rows);
    expect(filterConsumptionForSector(rows, 'Montagem')).toEqual([]);
  });

  it('preserva fallback legado e o contexto de cabedal no Aviamento', () => {
    const rows = adapt(line(null, 400)).map(toBulkConsumptionRow);
    const upper = { ...rows[0], component: 'Cabedal' as const, consumption_sector: null };
    expect(filterConsumptionForSector([...rows, upper], 'Aviamento')).toHaveLength(2);
    expect(filterConsumptionForSector(rows, 'Corte Fibra')).toEqual([]);
  });

  it('agrega OPs sem perder setor nem contar duas vezes a necessidade', () => {
    const a = adapt(line('Aviamento', 150)).map(toBulkConsumptionRow);
    const b = adapt(line('Solagem', 250)).map(toBulkConsumptionRow);
    const result = aggregateConsumption(new Map([['op-a', a], ['op-b', b]]), ['op-a', 'op-b']);
    expect(result).toHaveLength(2);
    expect(result.reduce((total, row) => total + row.required, 0)).toBe(400);
    expect(filterConsumptionForSector(result, 'Aviamento')[0].required).toBe(150);
    expect(filterConsumptionForSector(result, 'Solagem')[0].required).toBe(250);
  });

  it('leva a divisão por setor ao PDF sem duplicar o total do produto', () => {
    const rows = adapt(line('Aviamento', 150), line('Solagem', 250));
    const html = buildMaterialConsumptionReportHtml({ rows, artisanalStrapRows: [],
      title: 'Consumo — teste de setor', mode: 'total', generatedAt: new Date('2026-09-05T12:00:00Z') });
    expect(html).toContain('Aviamento: 150 un');
    expect(html).toContain('Solagem: 250 un');
    expect(html).toContain('>400<');
  });

  it('não disfarça setor conflitante como padrão legado nem o mistura com outra OP', () => {
    const conflicting = { ...line(null, 400), consumption_sector_source: 'ambiguous' };
    const rows = adapt(conflicting, line(null, 80));
    expect(rows).toHaveLength(2);
    expect(rows[0].warning).toContain('Setor de consumo conflitante');
    const bulk = rows.map(toBulkConsumptionRow);
    expect(filterConsumptionForSector(bulk, 'Aviamento').map(row => row.required)).toEqual([80]);
    expect(filterConsumptionForSector(bulk, 'Solagem')).toEqual([]);
    const aggregated = aggregateConsumption(new Map([['op', bulk]]), ['op']);
    expect(aggregated).toHaveLength(2);
    expect(aggregated.reduce((sum, row) => sum + row.required, 0)).toBe(480);
    const html = buildMaterialConsumptionReportHtml({ rows, artisanalStrapRows: [],
      title: 'Consumo', mode: 'total', generatedAt: new Date('2026-09-05T12:00:00Z') });
    expect(html).toContain('Setor de consumo conflitante');
  });
});

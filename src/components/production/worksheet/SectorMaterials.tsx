import type { ConsumptionRow } from '@/hooks/useBulkOrderConsumption';
import { filterConsumptionForSector } from '@/hooks/useBulkOrderConsumption';

interface Props {
  rows?: ConsumptionRow[];
  sector: string;
  /** Componentes que já possuem quadro operacional próprio nesta ficha. */
  excludeComponents?: string[];
}

/** Obrigações do posto; quantidade necessária não é comprovação de baixa. */
export function SectorMaterials({ rows = [], sector, excludeComponents = [] }: Props) {
  const materials = filterConsumptionForSector(rows, sector).filter(row => (
    (row.consumption_sector || row.component === 'Componente Direto' || row.component === 'BOM'
      || row.material_source === 'direct_components' || row.material_source === 'sheet_materials'
      || row.material_source === 'component_color' || row.material_source === 'component_color_default')
    && !excludeComponents.includes(row.component)
    && Number(row.required) > 0
  ));
  if (!materials.length) return null;

  return (
    <section aria-label={`Materiais do setor ${sector}`} className="keep-together mt-1"
      style={{ border: '1.5px solid #000', background: '#fff', color: '#000', fontFamily: "'Fira Sans', sans-serif" }}>
      <div style={{ borderBottom: '1px solid #000', padding: '4px 8px', fontSize: 10, fontWeight: 700 }}>
        Materiais do setor · quantidade necessária
      </div>
      {materials.map((row, index) => (
        <div key={`${row.product_id}:${row.component}:${row.consumption_sector || ''}:${index}`}
          style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
            padding: '4px 8px', borderTop: index ? '1px solid #000' : undefined }}>
          <div style={{ fontSize: 12, fontWeight: 700, overflowWrap: 'anywhere' }}>
            {row.product_name}{row.color ? ` · ${row.color}` : ''}
            {(!row.consumption_sector || row.consumption_sector_source === 'legacy_fallback') && (
              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 400 }}>padrão legado</span>
            )}
          </div>
          <div style={{ whiteSpace: 'nowrap', fontSize: 18, fontFamily: "'Anton', Impact, sans-serif" }}>
            {Number(row.required).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
            <span style={{ marginLeft: 5, fontSize: 11, fontFamily: "'Fira Code', monospace" }}>
              {row.source === 'width_missing' ? 'dm²' : row.unit}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

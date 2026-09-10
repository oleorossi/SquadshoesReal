import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_PRODUCTION_SECTORS } from '@/components/technical-sheets/ProductionSectorsTab';
import { CANONICAL_ROUTINGS } from '@/components/technical-sheets/ConstructionConfigPanel';
import {
  DISPLAY_SECTORS,
  SECTOR_FLOW,
  SECTOR_NORMALIZE,
  SECTOR_PARALLEL_GROUP,
  normalizeSector,
} from '@/lib/sectors';
import { norm } from '@/components/production/kanban/kanbanDerive';

const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations');
const ALIGN = '20270101022600_align_corte_cabedal_kanban_and_promote_fallback.sql';
const ALIGN_SQL = readFileSync(resolve(MIGRATIONS_DIR, ALIGN), 'utf8');

function latestPromoteBody(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .reverse();
  for (const name of files) {
    const text = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.promote_sale_order_item(');
    if (start < 0) continue;
    const tail = text.slice(start);
    const end = tail.indexOf('$function$;');
    expect(end, `${name}: promote sem terminador`).toBeGreaterThanOrEqual(0);
    return tail.slice(0, end);
  }
  throw new Error('promote_sale_order_item ausente');
}

describe('alinhamento Corte Cabedal · ficha × promote × kanban', () => {
  it('migration cria Corte Cabedal em sector_settings no grupo corte', () => {
    expect(ALIGN_SQL).toContain('INSERT INTO public.sector_settings');
    expect(ALIGN_SQL).toContain("'Corte Cabedal'");
    expect(ALIGN_SQL).toContain("parallel_group = 'corte'");
    expect(ALIGN_SQL).toMatch(/flow_order\s*=\s*15/);
  });

  it('promote_sale_order_item vivo usa fallback Corte Fibra…Expedição sem Mesa/Palmilha', () => {
    const body = latestPromoteBody();
    const fallback = body.match(/ARRAY\[\s*'Corte Fibra'[\s\S]*?\]/)?.[0] ?? '';
    const names = Array.from(fallback.matchAll(/'([^']+)'/g), (m) => m[1]);
    expect(names).toEqual([
      'Corte Fibra',
      'Corte Forração',
      'Costura Palmilha',
      'Costura Cabedal',
      'Aviamento',
      'Silk',
      'Colagem',
      'Montagem',
      'Solagem',
      'Acabamento',
      'Expedição',
    ]);
    expect(body).not.toMatch(/ARRAY\[[^\]]*Corte Palmilha/);
    expect(body).not.toMatch(/ARRAY\[[^\]]*'Mesa'/);
    expect(body).toContain('canonical_stage_name');
  });

  it('aba de setores e taxonomia front incluem Corte Cabedal', () => {
    expect(ALL_PRODUCTION_SECTORS.map((s) => s.name)).toContain('Corte Cabedal');
    expect(SECTOR_FLOW).toContain('Corte Cabedal');
    expect(DISPLAY_SECTORS.some((s) => s.key === 'corte_cabedal')).toBe(true);
    expect(SECTOR_PARALLEL_GROUP['Corte Cabedal']).toBe('corte');
    expect(normalizeSector('Corte Cabedal')).toBe('corte_cabedal');
    expect(SECTOR_NORMALIZE['corte cabedal']).toBe('corte_cabedal');
  });

  it('rotas canônicas do painel de construção que pedem Cabedal listam o setor', () => {
    const comCabedal = CANONICAL_ROUTINGS.filter((r) => r.includes('Corte Cabedal'));
    expect(comCabedal.length).toBeGreaterThanOrEqual(4);
    for (const rota of comCabedal) {
      expect(rota.indexOf('Corte Cabedal')).toBeGreaterThan(rota.indexOf('Corte Fibra'));
    }
  });

  it('kanban.norm mapeia aliases mortos pro nome vivo da coluna', () => {
    expect(norm('Corte Palmilha')).toBe('Corte Fibra');
    expect(norm('Mesa')).toBe('Aviamento');
    expect(norm('Corte Fibra')).toBe('Corte Fibra');
    expect(norm('Corte Cabedal')).toBe('Corte Cabedal');
  });
});

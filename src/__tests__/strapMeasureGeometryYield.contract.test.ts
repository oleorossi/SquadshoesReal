import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

const migration = read('supabase/migrations/20270101044000_strap-measure-geometry-yield.sql');
const panel = read('src/components/artisanal-straps/MeasureGeometryYieldPanel.tsx');
const hub = read('src/pages/ArtisanalStraps.tsx');
const hook = read('src/hooks/useStrapMeasureYieldBoard.ts');
const geom = read('src/lib/strapNapaGeometry.ts');

describe('strap measure geometry yield (Hub Configuração)', () => {
  it('migration espalha por geometria e herda napa nova', () => {
    expect(migration).toContain('set_strap_measure_geometry_yield');
    expect(migration).toContain('list_strap_measure_yield_board');
    expect(migration).toContain('inherit_strap_yields_for_napa_group');
    expect(migration).toContain('napa_geometries_match');
    expect(migration).toContain('strap_hub_measure_group_map');
    expect(migration).toContain('trg_inherit_strap_yields_on_sheet');
  });

  it('orientação 1000×1370 ≡ 1370×1000 na lib e no SQL', () => {
    expect(geom).toContain('normalizeStrapNapaGeometry');
    expect(geom).toContain('strapNapaGeometriesMatch');
    expect(migration).toContain('LEAST(p_width_mm, p_length_mm)');
    expect(migration).toContain('GREATEST(p_width_mm, p_length_mm)');
  });

  it('Configuração usa board do grupo, não MeasureYieldControl de receita', () => {
    expect(hub).toContain('MeasureGeometryYieldPanel');
    expect(hub).toContain('useStrapMeasureYieldBoard');
    expect(hub).toContain('Preencher faltantes');
    expect(hub).not.toContain('MeasureYieldControl');
    expect(panel).toContain('useSetStrapMeasureGeometryYield');
    expect(panel).toContain('Salvar e espalhar');
    expect(hook).toContain("rpc('set_strap_measure_geometry_yield'");
    expect(hook).toContain("rpc('list_strap_measure_yield_board'");
  });

  it('Operação tem Resumo (tiras + napa) e Detalhe', () => {
    expect(hub).toContain("viewMode === 'resumo'");
    expect(hub).toContain('TIRAS A FAZER');
    expect(hub).toContain('NAPA A PEDIR');
    expect(hub).toContain('Rendimento pendente');
  });

  it('persistência canônica continua em strap_group_napa_yields', () => {
    expect(migration).toContain('INSERT INTO public.strap_group_napa_yields');
    expect(migration).toContain('FROM public.artisanal_strap_recipes r');
  });
});

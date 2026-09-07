import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ConsumptionRow } from '@/hooks/useBulkOrderConsumption';
import { SectorMaterials } from '../SectorMaterials';
import { SilkMontageWorkSheet } from '../../SilkMontageWorkSheet';
import { SolagemWorkSheet } from '../../SolagemWorkSheet';
import { PalmilhaWorkSheet } from '../../PalmilhaWorkSheet';
import OperatorWorkSheet from '../../OperatorWorkSheet';
import { MemoryRouter } from 'react-router-dom';
import ArtisanalStrapRollCutBlock from '@/components/sale-orders/ArtisanalStrapRollCutBlock';
import { buildMaterialConsumptionReportHtml } from '@/lib/materialConsumptionReport';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';
import type { ProductionOrder } from '@/types/inventory';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {} unobserve() {} disconnect() {}
  };
});

describe('aviso de transformação física ainda não congelada', () => {
  it('mostra o aviso na tela e no PDF sem inventar napa nem pedir correção de receita', () => {
    const warning = 'A transformação física será congelada na primeira demanda.';
    const pending: ArtisanalStrapCutRow = {
      key: 'pending', groupName: 'TIRA OVERLOCK 5MM', color: 'PRETO',
      largura_mm: 5, metros_necessarios: 36,
      cut: { largura_mm: 5, metros_uteis_por_banda: 0, n_bandas: 0, cm_a_cortar: 0,
        rolos: 0, n_rolos_completos: 0, cm_no_ultimo_rolo: 0, valid: false, widthMissing: false },
      canonical: { recipeId: 'recipe', baseRequiredM: 0, confirmedYieldMPerM: 0,
        usableBaseWidthMm: 0, theoreticalYieldMPerM: 0, blockingReasons: [], snapshotWarning: warning },
    };
    render(<MemoryRouter><ArtisanalStrapRollCutBlock rows={[pending]} /></MemoryRouter>);
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.queryByText('Separar napa')).not.toBeInTheDocument();
    expect(screen.queryByText(/Corrigir receita/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Acompanhar no Hub/ })).toBeInTheDocument();
    const html = buildMaterialConsumptionReportHtml({ rows: [], artisanalStrapRows: [pending],
      title: 'Teste', mode: 'total', generatedAt: new Date('2026-09-05T12:00:00Z') });
    expect(html).toContain(warning);
    expect(html).not.toContain('>receita conferida<');
  });
});

const row = (sector: string, required: number): ConsumptionRow => ({
  product_id: 'binoculo', product_name: 'BINÓCULO 6MM', component: 'Componente Direto',
  consumption_per_unit: 4, required, available: 0, stock_ok: false, debit_mode: 'soft',
  unit: 'un', consumption_sector: sector, consumption_sector_source: 'snapshot',
  material_source: 'direct_components',
});
const rows = [row('Aviamento', 150), row('Solagem', 250)];

describe('materiais por setor na impressão real', () => {
  it('imprime a contribuição exata do setor, sem somar o mesmo produto de outro setor', () => {
    render(<><SectorMaterials rows={rows} sector="Aviamento" />
      <SectorMaterials rows={rows} sector="Solagem" /></>);
    expect(within(screen.getByRole('region', { name: 'Materiais do setor Aviamento' })).getByText('150')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Materiais do setor Solagem' })).getByText('250')).toBeInTheDocument();
    expect(screen.queryByText('400')).not.toBeInTheDocument();
    expect(screen.queryByText(/baixad[oa]/i)).not.toBeInTheDocument();
  });

  it('identifica o fallback legado e não repete o quadro de tiras', () => {
    render(<SectorMaterials sector="Aviamento" excludeComponents={['Tiras']} rows={[
      { ...row('', 400), consumption_sector_source: 'legacy_fallback' },
      { ...row('Aviamento', 50), component: 'Tiras', product_name: 'TIRA TESTE' },
    ]} />);
    expect(screen.getByText('padrão legado')).toBeInTheDocument();
    expect(screen.queryByText('TIRA TESTE')).not.toBeInTheDocument();
  });

  it('mostra somente o componente do Aviamento na ficha completa', () => {
    const { container } = render(<SilkMontageWorkSheet sector="Aviamento" groups={[{
      soleName: 'I91 TESTE', groupKind: 'reference', totalPairs: 100,
      colorGroups: [{ color: 'PRETO', totalPairs: 100, combinedGrid: {'34': 100},
        baseGrid: {'34': 10}, fichas: 10, opNumbers: ['OP-TESTE'], pvNumbers: ['PV-TESTE'], consumption: rows }],
    }]} />);
    expect(container.querySelector('[aria-label="Materiais do setor Aviamento"]')?.textContent).toContain('150');
    expect(container.querySelector('[aria-label="Materiais do setor Aviamento"]')?.textContent).not.toContain('250');
  });

  it.each(['component_color', 'component_color_default'])('preserva %s quando o setor usa fallback legado', (source) => {
    render(<SectorMaterials sector="Aviamento" rows={[
      { ...row('', 400), product_name: 'BINÓCULO DOURADO', component: 'Outros',
        material_source: source, consumption_sector_source: 'legacy_fallback' },
    ]} />);
    expect(screen.getByText('BINÓCULO DOURADO')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('padrão legado')).toBeInTheDocument();
  });

  it('conecta a mesma obrigação à ficha completa de Solagem', () => {
    const { container } = render(<SolagemWorkSheet allSizes={['34']} grandTotal={100} bands={[{
      soleColor: 'PRETO', totalPairs: 100, grade: {'34': 100}, consumption: rows,
    }]} />);
    const block = container.querySelector('[aria-label="Materiais do setor Solagem"]');
    expect(block?.textContent).toContain('250');
    expect(block?.textContent).not.toContain('150');
  });

  it('conecta o Corte Fibra e Montagem sem depender de classificação por nome', () => {
    const { container } = render(<>
      <PalmilhaWorkSheet allSizes={['34']} groups={[{ soleName: 'SOLADO TESTE',
        insoleColor: 'PRETO', totalPairs: 100, grade: {'34': 100}, consumption: [row('Corte Fibra', 70)] }]} />
      <OperatorWorkSheet sector="Montagem" items={[{
        order: { op_number: 'OP-TESTE', total_pairs: 100, grid: {'34': 100}, color: 'PRETO' } as unknown as ProductionOrder,
        consumption: [row('Montagem', 80)],
      }]} />
    </>);
    expect(container.querySelector('[aria-label="Materiais do setor Corte Fibra"]')?.textContent).toContain('70');
    expect(container.querySelector('[aria-label="Materiais do setor Montagem"]')?.textContent).toContain('80');
  });
});

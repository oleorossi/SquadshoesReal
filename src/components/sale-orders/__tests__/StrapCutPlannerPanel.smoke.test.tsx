import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ArtisanalStrapRollCutBlock from '@/components/sale-orders/ArtisanalStrapRollCutBlock';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

describe('StrapCutPlanner smoke', () => {
  it('expande Planejar napa do prestador e mostra altura 400 mm para 793,8 m', async () => {
    const row: ArtisanalStrapCutRow = {
      key: 'overlock-preto',
      groupName: 'TIRA OVERLOCK 5MM',
      color: 'PRETO',
      largura_mm: 20,
      metros_necessarios: 793.8,
      cut: {
        largura_mm: 20, metros_uteis_por_banda: 40, n_bandas: 20, cm_a_cortar: 40,
        rolos: 0.29, n_rolos_completos: 0, cm_no_ultimo_rolo: 40, valid: true, widthMissing: false,
      },
      canonical: {
        recipeId: 'r1', baseRequiredM: 11.34, confirmedYieldMPerM: 70,
        usableBaseWidthMm: 1370, theoreticalYieldMPerM: 68, transformationCostPerM: null,
        blockingReasons: [],
      },
    };
    render(<MemoryRouter><ArtisanalStrapRollCutBlock rows={[row]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Planejar napa do prestador/i }));
    expect(await screen.findByText('Altura a cortar')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText(/Pelo rendimento cadastrado/)).toBeInTheDocument();
    expect(screen.getByText(/Só planejamento/)).toBeInTheDocument();
  });
});

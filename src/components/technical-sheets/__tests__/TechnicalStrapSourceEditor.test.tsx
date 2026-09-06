import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import TechnicalStrapSourceEditor from '../TechnicalStrapSourceEditor';
import type { TechnicalStrapLineLike } from '@/lib/technicalStrapLines';
import type { TechnicalStrapSourceCatalog } from '@/lib/technicalStrapSourcePolicy';

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

type Line = TechnicalStrapLineLike & { consumption: number; consumption_per_size: Record<string, number> };
const catalog: TechnicalStrapSourceCatalog = {
  types: [{ id: 'strass', active: true }, { id: 'overlock', active: true }],
  measures: [{ id: '6mm', strap_type_id: 'strass', active: true }, { id: '5mm', strap_type_id: 'overlock', active: true }],
  variants: [
    { measure_id: '6mm', base_group_id: 'strass6', identity_basis: 'finished_product_group', internal_production_enabled: false, status: 'active', finished_product_id: 'cristal' },
    { measure_id: '5mm', base_group_id: 'glow', identity_basis: 'reference_base', internal_production_enabled: true, status: 'active' },
  ],
  recipes: [],
  products: [{ id: 'cristal', group_id: 'strass6', unit: 'm', active: true }, { id: 'glow-cobre', group_id: 'glow', unit: 'm', active: true }],
  groups: [{ id: 'strass6', name: 'TIRA STRASS 6MM' }, { id: 'glow', name: 'GLOW METALIC + MASSABOX' }],
};
const initial: Line = {
  id: 'posicao2', technical_strap_line_id: 'posicao2', label: 'TIRA 2',
  measure_id: '6mm', strap_type_id: 'strass', identity_basis: 'reference_base',
  color_mode: 'follow_main', material_mode: 'follow_reference',
  consumption: 61, consumption_per_size: { '34': 61 },
};

function mount(line = initial, sourceCatalog: TechnicalStrapSourceCatalog | undefined = catalog, loading = false) {
  let current = line;
  function Harness() {
    const [value, setValue] = useState(line);
    current = value;
    return <TechnicalStrapSourceEditor<Line> line={value} label="TIRA 2" catalog={sourceCatalog} loading={loading} onChange={setValue} />;
  }
  render(<Harness />);
  return { current: () => current };
}

describe('TechnicalStrapSourceEditor', () => {
  it('Strass 6 mm oferece só compra pronta e escolhe seu grupo exato ao corrigir a origem', async () => {
    const user = userEvent.setup();
    const view = mount();
    await user.click(screen.getByRole('combobox', { name: 'Base da identidade de TIRA 2' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Grupo próprio · comprada pronta']);
    expect(screen.queryByRole('option', { name: 'Produzida a partir do material do cabedal' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Grupo próprio · comprada pronta' }));
    expect(view.current()).toMatchObject({
      identity_basis: 'finished_product_group', identity_group_id: 'strass6',
      color_mode: 'select_on_order', internal_production_enabled: false,
      consumption: 61, consumption_per_size: { '34': 61 },
    });
    expect(screen.getByRole('combobox', { name: 'Grupo acabado de TIRA 2' })).toHaveTextContent('TIRA STRASS 6MM');
    await user.click(screen.getByRole('combobox', { name: 'Grupo acabado de TIRA 2' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['TIRA STRASS 6MM']);
    expect(screen.queryByRole('option', { name: 'GLOW METALIC + MASSABOX' })).not.toBeInTheDocument();
  });

  it('Overlock 5 mm oferece só produção interna e mantém a política de cor da posição', async () => {
    const user = userEvent.setup();
    const view = mount({ ...initial, measure_id: '5mm', strap_type_id: 'overlock' });
    await user.click(screen.getByRole('combobox', { name: 'Base da identidade de TIRA 2' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Produzida a partir do material do cabedal']);
    expect(screen.queryByRole('option', { name: 'Grupo próprio · comprada pronta' })).not.toBeInTheDocument();
    expect(view.current()).toMatchObject({ identity_basis: 'reference_base', color_mode: 'follow_main' });
    expect(screen.queryByRole('combobox', { name: 'Grupo acabado de TIRA 2' })).not.toBeInTheDocument();
  });

  it('permite as duas escolhas se a mesma medida tem produção e produto acabado ativos', async () => {
    const user = userEvent.setup();
    const hybrid = { ...catalog, variants: [...catalog.variants, { ...catalog.variants[1], measure_id: '6mm' }] };
    mount(initial, hybrid);
    await user.click(screen.getByRole('combobox', { name: 'Base da identidade de TIRA 2' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Produzida a partir do material do cabedal', 'Grupo próprio · comprada pronta',
    ]);
  });

  it('não reescreve a ficha ao abrir nem permite alterar origem enquanto carrega o catálogo', () => {
    const view = mount(initial, catalog, true);
    expect(view.current()).toEqual(initial);
    expect(screen.getByRole('combobox', { name: 'Base da identidade de TIRA 2' })).toBeDisabled();
  });

  it('exibe pendência quando a medida não possui nenhuma origem ativa', () => {
    mount(initial, { ...catalog, variants: [] });
    expect(screen.getByRole('combobox', { name: 'Base da identidade de TIRA 2' })).toBeDisabled();
    expect(screen.getByText('Esta família e medida ainda não possui origem ativa no catálogo de tiras.')).toBeInTheDocument();
  });
});
